// NWO BEAT – tijdelijke blokkades op de kaart (Leaflet + OpenStreetMap)

// ---------- Instellingen ----------

const NEDERLAND = [52.1326, 5.2913];
const OPSLAG_SLEUTEL = "nwo-beat-meldingen";

const TYPES = {
    wegafsluiting: { label: "Wegafsluiting", icoon: "⛔" },
    werkzaamheden: { label: "Werkzaamheden", icoon: "🚧" },
    ongeval: { label: "Ongeval", icoon: "💥" },
    evenement: { label: "Evenement", icoon: "🎪" },
    water: { label: "Wateroverlast", icoon: "🌊" },
    gevaarlijk: { label: "Gevaarlijke stoffen", icoon: "☣️" },
    obstakel: { label: "Obstakel op de weg", icoon: "🪨" },
    overig: { label: "Overig", icoon: "📍" },
};

const ERNST = {
    laag: { label: "Hinder", kleur: "#f5b400" },
    middel: { label: "Beperkt", kleur: "#ff7a2f" },
    hoog: { label: "Dicht", kleur: "#ef3e5c" },
};

const STATUS_LABEL = { actief: "Actief", gepland: "Gepland", verlopen: "Verlopen" };

// Foto's worden verkleind zodat ze in de browseropslag passen (~5 MB totaal)
const MAX_FOTOS = 4;
const FOTO_MAX_PIXELS = 1280;
const FOTO_KWALITEIT = 0.75;

// ---------- Kaart ----------

const map = L.map("map", { zoomControl: false }).setView(NEDERLAND, 8);
L.control.zoom({ position: "topright", zoomInTitle: "Inzoomen", zoomOutTitle: "Uitzoomen" }).addTo(map);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers',
}).addTo(map);

L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

const meldingLaag = L.layerGroup().addTo(map);

// ---------- Opslag (voorlopig alleen in deze browser) ----------

function laadMeldingen() {
    try {
        return JSON.parse(localStorage.getItem(OPSLAG_SLEUTEL)) || [];
    } catch {
        return [];
    }
}

function bewaarMeldingen() {
    try {
        localStorage.setItem(OPSLAG_SLEUTEL, JSON.stringify(meldingen));
        return true;
    } catch (err) {
        console.warn("Opslaan mislukt", err);
        return false;
    }
}

let meldingen = laadMeldingen();

// ---------- Hulpfuncties ----------

const HTML_TEKENS = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(tekst = "") {
    return String(tekst).replace(/[&<>"']/g, (c) => HTML_TEKENS[c]);
}

function statusVan(melding, nu = new Date()) {
    if (new Date(melding.start) > nu) return "gepland";
    if (melding.eind && new Date(melding.eind) < nu) return "verlopen";
    return "actief";
}

function formatDatum(iso) {
    if (!iso) return "onbekend";
    return new Date(iso).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
}

// Waarde voor <input type="datetime-local"> in lokale tijd
function naarInputDatum(datum) {
    const d = new Date(datum);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
}

function maakIcoon(melding) {
    const type = TYPES[melding.type] || TYPES.overig;
    const status = statusVan(melding);
    const puls = status === "actief" && melding.ernst === "hoog" ? " marker-puls" : "";
    return L.divIcon({
        className: "",
        html: `<div class="marker marker-${status}${puls}" style="--kleur:${ERNST[melding.ernst].kleur}"><span>${type.icoon}</span></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -38],
    });
}

function popupHtml(m) {
    const type = TYPES[m.type] || TYPES.overig;
    const status = statusVan(m);
    const regel = (label, waarde) => (waarde ? `<dt>${label}</dt><dd>${escapeHtml(waarde)}</dd>` : "");
    return `
        <div class="popup">
            <div class="popup-kop" style="--kleur:${ERNST[m.ernst].kleur}">
                <span class="popup-icoon">${type.icoon}</span>
                <div>
                    <p class="popup-type">${type.label}</p>
                    <h3>${escapeHtml(m.titel)}</h3>
                </div>
            </div>
            <div class="popup-badges">
                <span class="badge" style="background:${ERNST[m.ernst].kleur}">${ERNST[m.ernst].label}</span>
                <span class="badge badge-${status}">${STATUS_LABEL[status]}</span>
            </div>
            ${m.omschrijving ? `<p>${escapeHtml(m.omschrijving)}</p>` : ""}
            ${fotosHtml(m)}
            <dl>
                ${regel("Begin", formatDatum(m.start))}
                ${regel("Einde", m.eind ? formatDatum(m.eind) : "onbekend")}
                ${regel("Straal", m.straal ? `${m.straal} m` : "")}
                ${regel("Omleiding", m.omleiding)}
                ${regel("Contact", m.contact)}
                ${regel("Gemeld door", m.gemeldDoor)}
            </dl>
            <div class="popup-knoppen">
                <button class="btn btn-klein btn-licht" data-actie="bewerk" data-id="${m.id}">✏️ Bewerken</button>
                <button class="btn btn-klein btn-gevaar" data-actie="verwijder" data-id="${m.id}">🗑️ Verwijderen</button>
            </div>
        </div>`;
}

function fotosHtml(m) {
    if (!m.fotos?.length) return "";
    const fotos = m.fotos
        .map((src, i) => `<img src="${src}" alt="Foto ${i + 1}" data-foto="${m.id}" data-index="${i}">`)
        .join("");
    return `<div class="popup-fotos">${fotos}</div>`;
}

// ---------- Foto's ----------

// Teken een afbeelding/video-frame verkleind op een canvas en geef een JPEG data-URL terug
function naarVerkleindeFoto(bron, breedte, hoogte) {
    const schaal = Math.min(1, FOTO_MAX_PIXELS / Math.max(breedte, hoogte));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(breedte * schaal);
    canvas.height = Math.round(hoogte * schaal);
    canvas.getContext("2d").drawImage(bron, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", FOTO_KWALITEIT);
}

// Verklein een fotobestand en geef hem terug als JPEG data-URL
function verkleinFoto(bestand) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(bestand);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve(naarVerkleindeFoto(img, img.width, img.height));
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error(`Kan "${bestand.name}" niet lezen als afbeelding.`));
        };
        img.src = url;
    });
}

let huidigeFotos = []; // foto's in het geopende formulier

const fotoInput = document.getElementById("veld-fotos");
const cameraInput = document.getElementById("veld-camera");
const fotoPreview = document.getElementById("foto-preview");
document.getElementById("max-fotos").textContent = MAX_FOTOS;

function renderFotoPreview() {
    fotoPreview.innerHTML = huidigeFotos
        .map(
            (src, i) => `
            <div class="foto-thumb">
                <img src="${src}" alt="Foto ${i + 1}">
                <button type="button" class="foto-verwijder" data-index="${i}" aria-label="Foto verwijderen">✕</button>
            </div>`
        )
        .join("");
    document.getElementById("foto-knoppen").hidden = huidigeFotos.length >= MAX_FOTOS;
}

async function voegBestandenToe(input) {
    const bestanden = [...input.files];
    input.value = "";
    const ruimte = MAX_FOTOS - huidigeFotos.length;
    if (bestanden.length > ruimte) {
        alert(`Je kunt maximaal ${MAX_FOTOS} foto's toevoegen. Alleen de eerste ${ruimte} worden gebruikt.`);
    }
    for (const bestand of bestanden.slice(0, ruimte)) {
        try {
            huidigeFotos.push(await verkleinFoto(bestand));
        } catch (err) {
            alert(err.message);
        }
    }
    renderFotoPreview();
}

fotoInput.addEventListener("change", () => voegBestandenToe(fotoInput));
cameraInput.addEventListener("change", () => voegBestandenToe(cameraInput));

// ---------- Camera ----------

const cameraDialoog = document.getElementById("camera-dialoog");
const cameraVideo = document.getElementById("camera-video");
const btnWissel = document.getElementById("btn-camera-wissel");
let cameraStream = null;
let cameraRichting = "environment"; // achtercamera; "user" = voorcamera

// Op telefoons/tablets is de eigen camera-app het fijnst; op computers de webcam in de browser
const isTouchApparaat = matchMedia("(pointer: coarse)").matches;

async function startCamera() {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: cameraRichting }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
    });
    cameraVideo.srcObject = cameraStream;
}

function stopCamera() {
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
}

document.getElementById("btn-camera").addEventListener("click", async () => {
    if (isTouchApparaat || !navigator.mediaDevices?.getUserMedia) {
        cameraInput.click();
        return;
    }
    try {
        await startCamera();
        const cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
        btnWissel.hidden = cameras.length < 2;
        cameraDialoog.showModal();
    } catch (err) {
        console.error(err);
        const geweigerd = err.name === "NotAllowedError";
        alert(
            geweigerd
                ? "Geen toegang tot de camera. Geef toestemming in je browser (icoon links in de adresbalk) en probeer opnieuw."
                : "Er is geen camera gevonden of de camera is in gebruik. Je kunt wel een foto uploaden."
        );
    }
});

document.getElementById("btn-camera-foto").addEventListener("click", () => {
    if (!cameraVideo.videoWidth) return; // camera nog niet klaar
    huidigeFotos.push(naarVerkleindeFoto(cameraVideo, cameraVideo.videoWidth, cameraVideo.videoHeight));
    renderFotoPreview();
    cameraDialoog.close();
});

btnWissel.addEventListener("click", async () => {
    cameraRichting = cameraRichting === "environment" ? "user" : "environment";
    try {
        await startCamera();
    } catch (err) {
        console.error(err);
    }
});

document.getElementById("btn-camera-annuleer").addEventListener("click", () => cameraDialoog.close());
// Camera altijd uitzetten als het venster sluit (ook via Escape)
cameraDialoog.addEventListener("close", stopCamera);

fotoPreview.addEventListener("click", (e) => {
    const knop = e.target.closest(".foto-verwijder");
    if (!knop) return;
    huidigeFotos.splice(Number(knop.dataset.index), 1);
    renderFotoPreview();
});

// Vergrote weergave
const lightbox = document.getElementById("lightbox");
function toonFoto(src) {
    document.getElementById("lightbox-img").src = src;
    lightbox.showModal();
}
lightbox.addEventListener("click", () => lightbox.close());

// ---------- Filters ----------

// Type-chips in de zijbalk
document.getElementById("type-filter").innerHTML =
    `<label class="chip"><input type="radio" name="filter-type" value="" checked><span>✨ Alles</span></label>` +
    Object.entries(TYPES)
        .map(([waarde, t]) => `<label class="chip"><input type="radio" name="filter-type" value="${waarde}"><span>${t.icoon} ${t.label}</span></label>`)
        .join("");

// Type-tegels in het formulier
document.getElementById("type-keuze").innerHTML = Object.entries(TYPES)
    .map(
        ([waarde, t], i) => `
        <label class="type-tegel">
            <input type="radio" name="type" value="${waarde}"${i === 0 ? " required" : ""}>
            <span><span class="type-emoji">${t.icoon}</span>${t.label}</span>
        </label>`
    )
    .join("");

function actieveFilters() {
    const statussen = [...document.querySelectorAll('input[name="status"]:checked')].map((el) => el.value);
    const type = document.querySelector('input[name="filter-type"]:checked')?.value || "";
    return { statussen, type };
}

document.querySelector(".filters").addEventListener("change", render);

// ---------- Weergave ----------

const markers = new Map(); // id -> marker

function render() {
    meldingLaag.clearLayers();
    markers.clear();

    const { statussen, type } = actieveFilters();
    const zichtbaar = meldingen
        .filter((m) => statussen.includes(statusVan(m)) && (!type || m.type === type))
        .sort((a, b) => new Date(a.start) - new Date(b.start));

    for (const m of zichtbaar) {
        if (m.straal > 0) {
            L.circle([m.lat, m.lng], {
                radius: m.straal,
                color: ERNST[m.ernst].kleur,
                weight: 2,
                fillOpacity: 0.12,
                dashArray: statusVan(m) === "actief" ? null : "6 6",
            }).addTo(meldingLaag);
        }
        const marker = L.marker([m.lat, m.lng], { icon: maakIcoon(m), title: m.titel })
            .bindPopup(popupHtml(m), { maxWidth: 300 })
            .addTo(meldingLaag);
        markers.set(m.id, marker);
    }

    renderLijst(zichtbaar);
}

function renderLijst(zichtbaar) {
    document.getElementById("aantal").textContent = zichtbaar.length;
    document.getElementById("leeg").hidden = zichtbaar.length > 0;

    document.getElementById("lijst").innerHTML = zichtbaar
        .map((m) => {
            const type = TYPES[m.type] || TYPES.overig;
            const status = statusVan(m);
            return `
            <li>
                <button class="lijst-item" data-id="${m.id}" style="--kleur:${ERNST[m.ernst].kleur}">
                    <span class="lijst-icoon">${type.icoon}</span>
                    <span class="lijst-tekst">
                        <strong>${escapeHtml(m.titel)}</strong>
                        <small>${formatDatum(m.start)} → ${m.eind ? formatDatum(m.eind) : "onbekend"}</small>
                        <span class="lijst-tags">
                            <span class="tag tag-${status}">${STATUS_LABEL[status]}</span>
                            <span class="tag tag-ernst">${ERNST[m.ernst].label}</span>
                            ${m.fotos?.length ? `<span class="tag" title="${m.fotos.length} foto('s)">📷 ${m.fotos.length}</span>` : ""}
                        </span>
                    </span>
                </button>
            </li>`;
        })
        .join("");
}

document.getElementById("lijst").addEventListener("click", (e) => {
    const knop = e.target.closest(".lijst-item");
    const marker = knop && markers.get(knop.dataset.id);
    if (!marker) return;
    map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15));
    marker.openPopup();
});

// ---------- Melding toevoegen / bewerken ----------

const dialoog = document.getElementById("dialoog");
const form = document.getElementById("melding-form");
const plaatsHint = document.getElementById("plaats-hint");

let bewerkId = null;
let gekozenLocatie = null;
let plaatsModus = false;

function openFormulier(latlng, melding = null) {
    form.reset();
    bewerkId = melding ? melding.id : null;
    gekozenLocatie = latlng;
    document.getElementById("dialoog-titel").textContent = melding ? "Melding bewerken" : "Blokkade melden";
    document.getElementById("locatie-tekst").textContent = `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

    if (melding) {
        for (const [veld, waarde] of Object.entries(melding)) {
            const el = form.elements[veld];
            if (!el || waarde == null) continue;
            el.value = veld === "start" || veld === "eind" ? naarInputDatum(waarde) : waarde;
        }
    } else {
        form.elements.start.value = naarInputDatum(new Date());
    }

    huidigeFotos = melding?.fotos ? [...melding.fotos] : [];
    renderFotoPreview();

    // "Meer details" openklappen als daar al iets in staat
    document.getElementById("meer-details").open = Boolean(
        melding && (melding.straal || melding.omleiding || melding.contact || melding.gemeldDoor)
    );

    map.closePopup();
    dialoog.showModal();
}

form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));

    if (data.eind && new Date(data.eind) < new Date(data.start)) {
        form.elements.eind.setCustomValidity("Einde moet na het begin liggen.");
        form.elements.eind.reportValidity();
        return;
    }

    const nu = new Date().toISOString();
    const melding = {
        id: bewerkId || crypto.randomUUID(),
        type: data.type,
        ernst: data.ernst,
        titel: data.titel.trim(),
        omschrijving: data.omschrijving.trim(),
        start: new Date(data.start).toISOString(),
        eind: data.eind ? new Date(data.eind).toISOString() : null,
        straal: Number(data.straal) || 0,
        omleiding: data.omleiding.trim(),
        contact: data.contact.trim(),
        gemeldDoor: data.gemeldDoor.trim(),
        lat: gekozenLocatie.lat,
        lng: gekozenLocatie.lng,
        fotos: [...huidigeFotos],
        bijgewerkt: nu,
    };

    const vorige = meldingen;
    if (bewerkId) {
        meldingen = meldingen.map((m) => (m.id === bewerkId ? { ...m, ...melding } : m));
    } else {
        meldingen = [...meldingen, { ...melding, aangemaakt: nu }];
    }

    if (!bewaarMeldingen()) {
        meldingen = vorige;
        alert("Opslaan mislukt: de opslag in deze browser is vol. Verwijder een paar foto's of oude meldingen en probeer het opnieuw.");
        return;
    }

    dialoog.close();
    render();
    markers.get(melding.id)?.openPopup();
});

form.elements.eind.addEventListener("input", (e) => e.target.setCustomValidity(""));
document.getElementById("btn-annuleer").addEventListener("click", () => dialoog.close());
document.getElementById("btn-sluit").addEventListener("click", () => dialoog.close());

// ---------- Inspreken (spraak naar tekst) ----------
// Gebruikt de spraakherkenning van de browser (Chrome, Edge, Safari). Firefox ondersteunt dit niet.

const Spraakherkenning = window.SpeechRecognition || window.webkitSpeechRecognition;
const dicteerStatus = document.getElementById("dicteer-status");
const dicteerTekst = document.getElementById("dicteer-tekst");
let herkenning = null;
let actieveMicKnop = null;

function toonDicteerStatus(tekst, isFout = false) {
    dicteerTekst.textContent = tekst;
    dicteerStatus.classList.toggle("fout", isFout);
    dicteerStatus.hidden = false;
}

function stopDicteren() {
    herkenning?.stop();
}

// Omgevingen waarin spraakherkenning wel "bestaat" maar niet werkt
function dicteerProbleem() {
    if (location.protocol === "file:") {
        return "Inspreken werkt niet als je het bestand direct opent. Start de site via Live Server (http://localhost of 127.0.0.1).";
    }
    if (/Electron|Code\//.test(navigator.userAgent)) {
        return "Inspreken werkt niet in de ingebouwde browser van VS Code. Open de site in Chrome of Edge.";
    }
    if (navigator.brave) {
        return "Brave ondersteunt inspreken niet. Gebruik Chrome, Edge of Safari.";
    }
    return null;
}

function startDicteren(knop) {
    const probleem = dicteerProbleem();
    if (probleem) {
        toonDicteerStatus(probleem, true);
        return;
    }

    const veld = form.elements[knop.dataset.dicteer];
    const isTitel = veld.tagName === "INPUT";
    // Bestaande tekst bewaren; ingesproken tekst komt erachter
    const begintekst = veld.value.trim() ? veld.value.trimEnd() + " " : "";
    let definitief = "";

    const r = new Spraakherkenning();
    herkenning = r;
    r.lang = "nl-NL";
    r.continuous = !isTitel; // titel: één zin, omschrijving: blijft luisteren
    r.interimResults = true;

    let foutGetoond = false;
    let ietsGehoord = false;

    // Tussenstappen tonen, zodat je ziet waar het blijft hangen
    r.onstart = () => toonDicteerStatus("Microfoon wordt gestart…");
    r.onaudiostart = () => toonDicteerStatus("Ik luister… praat maar. Tik nog eens op de microfoon om te stoppen.");
    r.onspeechstart = () => toonDicteerStatus("Ik hoor je! Even verwerken…");

    r.onresult = (e) => {
        ietsGehoord = true;
        toonDicteerStatus("Ik luister… tik op de microfoon om te stoppen.");
        let tussentijds = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
            const tekst = e.results[i][0].transcript;
            if (e.results[i].isFinal) definitief += tekst;
            else tussentijds += tekst;
        }
        let nieuw = begintekst + definitief + tussentijds;
        // Eerste letter als hoofdletter
        nieuw = nieuw.charAt(0).toUpperCase() + nieuw.slice(1);
        veld.value = isTitel ? nieuw.slice(0, veld.maxLength) : nieuw;
        veld.scrollTop = veld.scrollHeight;
    };

    r.onerror = (e) => {
        console.warn("Spraakherkenning fout:", e.error, e.message);
        if (e.error === "aborted") return; // zelf gestopt
        const teksten = {
            "not-allowed": "Geen toegang tot de microfoon. Klik op het slotje links in de adresbalk, zet Microfoon op 'Toestaan' en probeer opnieuw.",
            "service-not-allowed": "Spraakherkenning is geblokkeerd in deze browser. Probeer Chrome.",
            "audio-capture": "Er is geen microfoon gevonden. Controleer of je microfoon is aangesloten en geselecteerd.",
            network: "De spraakdienst is niet bereikbaar. Controleer je internetverbinding (of probeer Chrome).",
            "no-speech": "Ik heb niets gehoord. Staat de goede microfoon aan? (Chrome: slotje in de adresbalk → Site-instellingen → Microfoon)",
            "language-not-supported": "Nederlands wordt niet ondersteund door de spraakdienst van deze browser.",
        };
        foutGetoond = true;
        toonDicteerStatus(teksten[e.error] || `Inspreken mislukt (${e.error}).`, true);
    };

    r.onend = () => {
        knop.classList.remove("luistert");
        // Alleen opruimen als er intussen geen nieuwe opname is gestart
        if (herkenning === r) {
            herkenning = null;
            actieveMicKnop = null;
            if (foutGetoond) return; // foutmelding laten staan
            if (!ietsGehoord) {
                toonDicteerStatus("Er is geen tekst herkend. Praat iets dichter bij de microfoon en probeer het nog eens.", true);
                return;
            }
            dicteerStatus.hidden = true;
        }
    };

    try {
        r.start();
    } catch (err) {
        console.error(err);
        toonDicteerStatus("Inspreken kon niet starten. Probeer het nog eens.", true);
        herkenning = null;
        return;
    }
    actieveMicKnop = knop;
    knop.classList.add("luistert");
    toonDicteerStatus("Microfoon wordt gestart…");
    veld.focus();
}

document.querySelectorAll(".mic-knop").forEach((knop) => {
    if (!Spraakherkenning) {
        knop.hidden = true; // browser kan het niet
        return;
    }
    knop.addEventListener("click", () => {
        const wasDezeKnop = actieveMicKnop === knop;
        // Lopende opname stoppen; bij een andere knop daarna die starten
        if (herkenning) {
            const oud = herkenning;
            actieveMicKnop?.classList.remove("luistert");
            herkenning = null;
            actieveMicKnop = null;
            dicteerStatus.hidden = true;
            oud.stop();
        }
        if (!wasDezeKnop) startDicteren(knop);
    });
});

// Microfoon altijd uit als het formulier sluit; oude meldingen weghalen bij openen
dialoog.addEventListener("close", () => {
    stopDicteren();
    dicteerStatus.hidden = true;
});

// Klik op de kaart: direct melden (plaatsmodus) of eerst een kleine popup tonen
map.on("click", (e) => {
    if (plaatsModus) {
        zetPlaatsModus(false);
        openFormulier(e.latlng);
        return;
    }
    const inhoud = document.createElement("div");
    inhoud.innerHTML = `<button class="btn btn-primary btn-klein" type="button">📍 Blokkade hier melden</button>`;
    inhoud.querySelector("button").addEventListener("click", () => openFormulier(e.latlng));
    L.popup().setLatLng(e.latlng).setContent(inhoud).openOn(map);
});

function zetPlaatsModus(aan) {
    plaatsModus = aan;
    plaatsHint.hidden = !aan;
    document.getElementById("map").classList.toggle("plaatsen", aan);
    document.body.classList.toggle("plaats-modus", aan);
}

document.getElementById("btn-nieuw").addEventListener("click", () => zetPlaatsModus(true));
document.getElementById("btn-annuleer-plaats").addEventListener("click", () => zetPlaatsModus(false));
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") zetPlaatsModus(false);
});

// Knoppen in popups (bewerken / verwijderen).
// Capture-fase, omdat Leaflet klikken binnen popups tegenhoudt.
document.addEventListener(
    "click",
    (e) => {
        const foto = e.target.closest(".leaflet-popup [data-foto]");
        if (foto) {
            toonFoto(foto.src);
            return;
        }

        const knop = e.target.closest(".leaflet-popup [data-actie]");
        if (!knop) return;
        const melding = meldingen.find((m) => m.id === knop.dataset.id);
        if (!melding) return;

        if (knop.dataset.actie === "bewerk") {
            openFormulier(L.latLng(melding.lat, melding.lng), melding);
        } else if (knop.dataset.actie === "verwijder" && confirm(`Melding "${melding.titel}" verwijderen?`)) {
            meldingen = meldingen.filter((m) => m.id !== melding.id);
            bewaarMeldingen();
            map.closePopup();
            render();
        }
    },
    true
);

// ---------- Mijn locatie ----------

const btnLocatie = document.getElementById("btn-locatie");
let mijnLocatie = null;
let locatieMarker = null;
let nauwkeurigheidCirkel = null;
let locatieWatchId = null;
let centreerBijEersteFix = false;

function locatiePopup() {
    const inhoud = document.createElement("div");
    inhoud.className = "popup";
    inhoud.innerHTML = `
        <p class="popup-type">Jouw locatie</p>
        <p class="locatie-nauwkeurig"></p>
        <button class="btn btn-primary btn-klein" type="button">📍 Blokkade hier melden</button>`;
    inhoud.querySelector("button").addEventListener("click", () => openFormulier(mijnLocatie));
    return inhoud;
}

function locatieGevonden(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    mijnLocatie = L.latLng(latitude, longitude);

    if (!locatieMarker) {
        locatieMarker = L.marker(mijnLocatie, {
            icon: L.divIcon({ className: "", html: '<div class="mijn-locatie"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
            zIndexOffset: 1000,
            title: "Jouw locatie",
        })
            .bindPopup(locatiePopup())
            .addTo(map);
        nauwkeurigheidCirkel = L.circle(mijnLocatie, {
            radius: accuracy,
            color: "#2f80ff",
            weight: 1,
            fillColor: "#2f80ff",
            fillOpacity: 0.1,
            interactive: false,
        }).addTo(map);
    } else {
        locatieMarker.setLatLng(mijnLocatie);
        nauwkeurigheidCirkel.setLatLng(mijnLocatie).setRadius(accuracy);
    }

    const tekst = locatieMarker.getPopup().getContent().querySelector(".locatie-nauwkeurig");
    tekst.textContent = `Nauwkeurig tot ± ${Math.round(accuracy)} m`;

    btnLocatie.classList.remove("zoeken");
    btnLocatie.classList.add("actief");

    if (centreerBijEersteFix) {
        centreerBijEersteFix = false;
        map.setView(mijnLocatie, Math.max(map.getZoom(), 16));
    }
}

function locatieFout(err) {
    btnLocatie.classList.remove("zoeken");
    const foutTeksten = {
        1: "Je hebt geen toestemming gegeven om je locatie te gebruiken. Sta dit toe in je browser (icoon links in de adresbalk) en probeer opnieuw.",
        2: "Je locatie kon niet bepaald worden. Staat locatie/GPS aan op je apparaat?",
        3: "Het duurde te lang om je locatie te bepalen. Probeer het nog eens.",
    };
    // Bij weigeren of als er nog nooit een locatie was: stoppen en melden
    if (err.code === 1 || !mijnLocatie) {
        navigator.geolocation.clearWatch(locatieWatchId);
        locatieWatchId = null;
        btnLocatie.classList.remove("actief");
        alert(foutTeksten[err.code] || "Je locatie kon niet bepaald worden.");
    }
}

btnLocatie.addEventListener("click", () => {
    if (!navigator.geolocation) {
        alert("Je browser ondersteunt geen locatiebepaling.");
        return;
    }
    // Al bekend: alleen terug naar jezelf
    if (mijnLocatie) {
        map.setView(mijnLocatie, Math.max(map.getZoom(), 16));
        return;
    }
    if (locatieWatchId !== null) return; // al aan het zoeken

    btnLocatie.classList.add("zoeken");
    centreerBijEersteFix = true;
    locatieWatchId = navigator.geolocation.watchPosition(locatieGevonden, locatieFout, {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 20_000,
    });
});

// ---------- Adres zoeken (Nominatim / OpenStreetMap) ----------

document.getElementById("zoek-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const zoekterm = document.getElementById("zoek-input").value.trim();
    if (!zoekterm) return;

    try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl&q=${encodeURIComponent(zoekterm)}`;
        const resultaten = await (await fetch(url, { headers: { "Accept-Language": "nl" } })).json();
        if (!resultaten.length) {
            alert("Geen locatie gevonden.");
            return;
        }
        const { lat, lon, boundingbox, display_name } = resultaten[0];
        const [zuid, noord, west, oost] = boundingbox.map(Number);
        map.fitBounds([[zuid, west], [noord, oost]], { maxZoom: 17 });
        L.popup().setLatLng([lat, lon]).setContent(escapeHtml(display_name)).openOn(map);
    } catch (err) {
        console.error(err);
        alert("Zoeken mislukt. Controleer je internetverbinding.");
    }
});

// ---------- Start ----------

render();
// Status (gepland → actief → verlopen) elke minuut bijwerken
setInterval(render, 60_000);
