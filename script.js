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
    middel: { label: "Beperkt", kleur: "#ff6631" },
    hoog: { label: "Dicht", kleur: "#e5294a" },
};

const STATUS_LABEL = { actief: "Actief", gepland: "Gepland", verlopen: "Verlopen" };

// Foto's worden verkleind zodat ze in de browseropslag passen (~5 MB totaal)
const MAX_FOTOS = 4;
const FOTO_MAX_PIXELS = 1280;
const FOTO_KWALITEIT = 0.75;

// ---------- Eigen meldingen (toasts) en bevestigingen ----------

const toastContainer = document.getElementById("toasts");
const TOAST_ICONEN = { info: "💡", succes: "✅", fout: "⚠️" };

// Kort berichtje dat vanzelf weer verdwijnt
function toast(tekst, type = "info", duur = 5000) {
    const el = document.createElement("div");
    el.className = `toast toast-${type}`;
    el.setAttribute("role", type === "fout" ? "alert" : "status");
    el.innerHTML = `
        <span class="toast-icoon">${TOAST_ICONEN[type]}</span>
        <p class="toast-tekst"></p>
        <button class="toast-sluit" type="button" aria-label="Sluiten">✕</button>`;
    el.querySelector(".toast-tekst").textContent = tekst;

    const sluit = () => {
        if (el.classList.contains("weg")) return;
        el.classList.add("weg");
        setTimeout(() => {
            el.remove();
            if (!toastContainer.children.length) toastContainer.hidePopover?.();
        }, 300);
    };
    el.querySelector(".toast-sluit").addEventListener("click", sluit);
    setTimeout(sluit, duur);

    toastContainer.append(el);
    // Opnieuw tonen zodat de toasts boven een eventueel open venster komen
    if (toastContainer.showPopover) {
        if (toastContainer.matches(":popover-open")) toastContainer.hidePopover();
        toastContainer.showPopover();
    }
}

const bevestigDialoog = document.getElementById("bevestig-dialoog");

// Eigen vervanger voor confirm(): geeft een Promise<boolean>
function bevestig({ titel, tekst = "", okTekst = "OK", annuleerTekst = "Annuleren", icoon = "❓", gevaar = false }) {
    document.getElementById("bevestig-titel").textContent = titel;
    document.getElementById("bevestig-tekst").textContent = tekst;
    document.getElementById("bevestig-icoon").textContent = icoon;
    document.getElementById("bevestig-annuleer").textContent = annuleerTekst;
    const ok = document.getElementById("bevestig-ok");
    ok.textContent = okTekst;
    ok.classList.toggle("btn-gevaar-vol", gevaar);
    bevestigDialoog.classList.toggle("gevaar", gevaar);

    bevestigDialoog.returnValue = "";
    bevestigDialoog.showModal();
    document.getElementById("bevestig-annuleer").focus();

    return new Promise((resolve) => {
        bevestigDialoog.addEventListener("close", () => resolve(bevestigDialoog.returnValue === "ok"), { once: true });
    });
}

// Klik op de achtergrond = annuleren
bevestigDialoog.addEventListener("click", (e) => {
    if (e.target === bevestigDialoog) bevestigDialoog.close("annuleer");
});

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
                <button class="btn btn-klein btn-licht" data-actie="route" data-id="${m.id}">🧭 Route</button>
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
    formGewijzigd = true; // wordt bij openen van het formulier weer op false gezet
}

async function voegBestandenToe(input) {
    const bestanden = [...input.files];
    input.value = "";
    const ruimte = MAX_FOTOS - huidigeFotos.length;
    if (bestanden.length > ruimte) {
        toast(`Je kunt maximaal ${MAX_FOTOS} foto's toevoegen. Alleen de eerste ${ruimte} zijn gebruikt.`, "info");
    }
    for (const bestand of bestanden.slice(0, ruimte)) {
        try {
            huidigeFotos.push(await verkleinFoto(bestand));
        } catch (err) {
            toast(err.message, "fout");
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
        toast(
            geweigerd
                ? "Geen toegang tot de camera. Geef toestemming in je browser (icoon links in de adresbalk) en probeer opnieuw."
                : "Er is geen camera gevonden of de camera is in gebruik. Je kunt wel een foto uploaden.",
            "fout",
            8000
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

function actieveStatussen() {
    return [...document.querySelectorAll('input[name="status"]:checked')].map((el) => el.value);
}

document.querySelector(".filters").addEventListener("change", render);

// ---------- Weergave ----------

const markers = new Map(); // id -> marker

function render() {
    meldingLaag.clearLayers();
    markers.clear();

    const statussen = actieveStatussen();
    const zichtbaar = meldingen
        .filter((m) => statussen.includes(statusVan(m)))
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
    routeBlokkadesBijwerken();
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

    wisFouten();
    formGewijzigd = false;

    map.closePopup();
    dialoog.showModal();
}

// ---------- Eigen formuliercontrole (i.p.v. Chrome-ballonnetjes) ----------

let formGewijzigd = false;

function wisFouten() {
    form.querySelectorAll(".veld-fout").forEach((el) => el.remove());
    form.querySelectorAll(".ongeldig").forEach((el) => el.classList.remove("ongeldig"));
}

function toonVeldFout(veld, tekst) {
    // Bij radioknoppen/tegels de hele groep markeren, anders het veld zelf
    const houder = veld.closest(".type-tegels, .ernst-keuze") || veld.closest(".dicteer-veld") || veld;
    houder.classList.add("ongeldig");
    const fout = document.createElement("p");
    fout.className = "veld-fout";
    fout.textContent = tekst;
    houder.insertAdjacentElement("afterend", fout);
    return houder;
}

function controleerFormulier(data) {
    wisFouten();
    const fouten = [];
    if (!data.type) fouten.push([form.querySelector('input[name="type"]'), "Kies wat er aan de hand is."]);
    if (!data.titel?.trim()) fouten.push([form.elements.titel, "Geef de melding een korte titel."]);
    if (!data.start) fouten.push([form.elements.start, "Vul in vanaf wanneer de blokkade geldt."]);
    else if (data.eind && new Date(data.eind) < new Date(data.start)) {
        fouten.push([form.elements.eind, "Het einde moet na het begin liggen."]);
    }

    fouten.forEach(([veld, tekst]) => toonVeldFout(veld, tekst));
    if (fouten.length) {
        const eerste = form.querySelector(".ongeldig");
        eerste.scrollIntoView({ behavior: "smooth", block: "center" });
        // Schudden als visuele hint
        eerste.classList.remove("schud");
        void eerste.offsetWidth;
        eerste.classList.add("schud");
        if (fouten[0][0].type !== "radio") fouten[0][0].focus({ preventScroll: true });
    }
    return fouten.length === 0;
}

// Foutmelding weghalen zodra je het veld aanpast; bijhouden of er iets gewijzigd is
form.addEventListener("input", (e) => {
    formGewijzigd = true;
    const houder = e.target.closest(".ongeldig") || (e.target.classList.contains("ongeldig") && e.target);
    if (houder) {
        houder.classList.remove("ongeldig");
        if (houder.nextElementSibling?.classList.contains("veld-fout")) houder.nextElementSibling.remove();
    }
});

// Sluiten met niet-opgeslagen wijzigingen: eerst vragen
async function probeerFormulierTeSluiten() {
    if (formGewijzigd) {
        const weggooien = await bevestig({
            titel: "Wijzigingen weggooien?",
            tekst: "Je hebt dingen ingevuld die nog niet zijn opgeslagen.",
            okTekst: "Weggooien",
            annuleerTekst: "Verder invullen",
            icoon: "📝",
            gevaar: true,
        });
        if (!weggooien) return;
    }
    dialoog.close();
}

// Escape in het formulier
dialoog.addEventListener("cancel", (e) => {
    e.preventDefault();
    probeerFormulierTeSluiten();
});

form.addEventListener("submit", (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));

    if (!controleerFormulier(data)) return;

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
        toast("Opslaan mislukt: de opslag in deze browser is vol. Verwijder een paar foto's of oude meldingen en probeer het opnieuw.", "fout", 8000);
        return;
    }

    dialoog.close();
    render();
    markers.get(melding.id)?.openPopup();
    toast(bewerkId ? "Melding bijgewerkt" : "Melding geplaatst — bedankt!", "succes", 3000);
});

document.getElementById("btn-annuleer").addEventListener("click", probeerFormulierTeSluiten);
document.getElementById("btn-sluit").addEventListener("click", probeerFormulierTeSluiten);

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
    inhoud.className = "popup-knoppen-stapel";
    inhoud.innerHTML = `
        <button class="btn btn-primary btn-klein" type="button" data-kies="melden">📍 Blokkade hier melden</button>
        <button class="btn btn-licht btn-klein" type="button" data-kies="route">🧭 Route hierheen</button>`;
    inhoud.querySelector('[data-kies="melden"]').addEventListener("click", () => openFormulier(e.latlng));
    inhoud.querySelector('[data-kies="route"]').addEventListener("click", () => {
        map.closePopup();
        routeNaar(e.latlng, "Gekozen punt op de kaart");
    });
    L.popup().setLatLng(e.latlng).setContent(inhoud).openOn(map);
});

function zetPlaatsModus(aan) {
    plaatsModus = aan;
    plaatsHint.hidden = !aan;
    document.getElementById("map").classList.toggle("plaatsen", aan);
    document.body.classList.toggle("plaats-modus", aan);
}

// Melden-knop: normaal een plek op de kaart kiezen, tijdens het volgen van een route direct "hier melden"
const btnNieuw = document.getElementById("btn-nieuw");
btnNieuw.addEventListener("click", () => (volgen ? openSnelMelding() : zetPlaatsModus(true)));

function zetMeldKnop(hier) {
    btnNieuw.querySelector(".fab-tekst").textContent = hier ? "Hier melden" : "Melden";
    btnNieuw.setAttribute("aria-label", hier ? "Blokkade melden op je huidige locatie" : "Blokkade melden");
}
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

        if (knop.dataset.actie === "route") {
            map.closePopup();
            routeNaar(L.latLng(melding.lat, melding.lng), melding.titel);
        } else if (knop.dataset.actie === "bewerk") {
            openFormulier(L.latLng(melding.lat, melding.lng), melding);
        } else if (knop.dataset.actie === "verwijder") {
            bevestig({
                titel: "Melding verwijderen?",
                tekst: `"${melding.titel}" wordt definitief verwijderd. Dit kun je niet ongedaan maken.`,
                okTekst: "Ja, verwijderen",
                icoon: "🗑️",
                gevaar: true,
            }).then((ja) => {
                if (!ja) return;
                meldingen = meldingen.filter((m) => m.id !== melding.id);
                bewaarMeldingen();
                map.closePopup();
                render();
                toast("Melding verwijderd", "succes", 3000);
            });
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

    locatieWachtenden.splice(0).forEach((w) => w.resolve(mijnLocatie));
    if (volgen) volgUpdate(accuracy);
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
        toast(foutTeksten[err.code] || "Je locatie kon niet bepaald worden.", "fout", 8000);
        locatieWachtenden.splice(0).forEach((w) => w.reject(err));
    }
}

// Wie op een (eerste) locatie wacht, bijv. de routeplanner
const locatieWachtenden = [];

function startLocatie(centreer) {
    if (locatieWatchId !== null) return; // loopt al
    btnLocatie.classList.add("zoeken");
    centreerBijEersteFix = centreer;
    locatieWatchId = navigator.geolocation.watchPosition(locatieGevonden, locatieFout, {
        enableHighAccuracy: true,
        maximumAge: 5_000,
        timeout: 20_000,
    });
}

/** Geeft je locatie terug; start zo nodig de locatiebepaling. */
function vraagLocatie() {
    if (!navigator.geolocation) {
        toast("Je browser ondersteunt geen locatiebepaling.", "fout");
        return Promise.reject(new Error("geen geolocatie"));
    }
    if (mijnLocatie && locatieWatchId !== null) return Promise.resolve(mijnLocatie);
    return new Promise((resolve, reject) => {
        locatieWachtenden.push({ resolve, reject });
        startLocatie(false);
    });
}

btnLocatie.addEventListener("click", () => {
    if (!navigator.geolocation) {
        toast("Je browser ondersteunt geen locatiebepaling.", "fout");
        return;
    }
    // Al bekend: alleen terug naar jezelf (en tijdens het volgen de kaart weer laten meebewegen)
    if (mijnLocatie) {
        if (volgen) volgKaartMee = true;
        map.setView(mijnLocatie, Math.max(map.getZoom(), volgen ? 17 : 16));
        return;
    }
    startLocatie(true);
});

// ---------- Adres zoeken (Nominatim / OpenStreetMap) ----------

/** Zoekt een plek; geeft het eerste resultaat terug of null. Gooit bij netwerkfouten. */
async function zoekPlek(zoekterm) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl&q=${encodeURIComponent(zoekterm)}`;
    const resultaten = await (await fetch(url, { headers: { "Accept-Language": "nl" } })).json();
    return resultaten[0] || null;
}

document.getElementById("zoek-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const zoekterm = document.getElementById("zoek-input").value.trim();
    if (!zoekterm) return;

    try {
        const plek = await zoekPlek(zoekterm);
        if (!plek) {
            toast(`Geen plek gevonden voor "${zoekterm}". Probeer een andere schrijfwijze.`, "info");
            return;
        }
        const { lat, lon, boundingbox, display_name } = plek;
        const [zuid, noord, west, oost] = boundingbox.map(Number);
        map.fitBounds([[zuid, west], [noord, oost]], { maxZoom: 17 });

        const inhoud = document.createElement("div");
        inhoud.className = "popup-knoppen-stapel";
        inhoud.innerHTML = `<p>${escapeHtml(display_name)}</p>
            <button class="btn btn-primary btn-klein" type="button">🧭 Route hierheen</button>`;
        inhoud.querySelector("button").addEventListener("click", () => {
            map.closePopup();
            routeNaar(L.latLng(lat, lon), display_name.split(",")[0]);
        });
        L.popup().setLatLng([lat, lon]).setContent(inhoud).openOn(map);
    } catch (err) {
        console.error(err);
        toast("Zoeken mislukt. Controleer je internetverbinding.", "fout");
    }
});

// ---------- Route plannen en volgen ----------
// Routes komen van de gratis OSRM-server van OpenStreetMap Duitsland (auto, fiets, lopen).

const ROUTE_PROFIELEN = { auto: "routed-car", fiets: "routed-bike", lopen: "routed-foot" };
const NU_DREMPEL = { auto: 80, fiets: 40, lopen: 20 }; // vanaf hoeveel meter "nu afslaan" gezegd wordt

const btnRoute = document.getElementById("btn-route");
const routePaneel = document.getElementById("route-paneel");
const meldPaneel = document.querySelector(".paneel:not(.route-paneel)");
const routeForm = document.getElementById("route-form");
const routePlanKnop = routeForm.querySelector(".route-plan-knop");
const routeVanInput = document.getElementById("route-van");
const routeNaarInput = document.getElementById("route-naar");
const routeResultaat = document.getElementById("route-resultaat");
const routeWaarschuwing = document.getElementById("route-waarschuwing");
const routeStappenLijst = document.getElementById("route-stappen");
const navStap = document.getElementById("nav-stap");
const btnVolgen = document.getElementById("btn-volgen");
const btnGeluid = document.getElementById("btn-geluid");
const routeLaag = L.layerGroup().addTo(map);

// Gekozen punten: { latlng, label }. Zolang de tekst in het veld gelijk is aan label, gebruiken we latlng.
const routePunten = { van: null, naar: null };
let routeOpties = []; // berekende routes, beste eerst
let actieveRoute = null;
let routeBezig = false;

let volgen = false;
let volgKaartMee = true;
let geluidAan = true;
let huidigeStap = -1;
let nuGezegd = false;
let laatsteHerberekening = 0;
let schermSlot = null;
const gewaarschuwd = new Set();

// --- Teksten en opmaak ---

const RICHTINGEN = {
    uturn: ["Keer om", "↶"],
    "sharp right": ["Sla scherp rechtsaf", "↘"],
    right: ["Sla rechtsaf", "→"],
    "slight right": ["Houd rechts aan", "↗"],
    straight: ["Ga rechtdoor", "↑"],
    "slight left": ["Houd links aan", "↖"],
    left: ["Sla linksaf", "←"],
    "sharp left": ["Sla scherp linksaf", "↙"],
};
const RANGTELWOORDEN = ["", "eerste", "tweede", "derde", "vierde", "vijfde", "zesde", "zevende", "achtste"];

/** Zet een OSRM-stap om in een Nederlandse aanwijzing met pijl. */
function instructie(stap) {
    const { type, modifier = "straight", exit } = stap.maneuver;
    const weg = stap.name || stap.ref || "";
    const naar = weg ? ` naar ${weg}` : "";
    const [actie, pijl] = RICHTINGEN[modifier] || RICHTINGEN.straight;
    const links = modifier.includes("left");

    switch (type) {
        case "depart":
            return { tekst: weg ? `Vertrek via ${weg}` : "Vertrek", pijl: "●" };
        case "arrive":
            return { tekst: "Je bent op je bestemming", pijl: "🏁" };
        case "roundabout":
        case "rotary":
            return {
                tekst: exit ? `Neem op de rotonde de ${RANGTELWOORDEN[exit] || exit + "e"} afslag${naar}` : `Ga de rotonde op${naar}`,
                pijl: "⟳",
            };
        case "roundabout turn":
            return { tekst: `${actie} op de rotonde${naar}`, pijl };
        case "exit roundabout":
        case "exit rotary":
            return { tekst: `Verlaat de rotonde${naar}`, pijl };
        case "on ramp":
            return { tekst: `Neem de oprit${naar}`, pijl };
        case "off ramp":
            return { tekst: `Neem de afrit${naar}`, pijl };
        case "fork":
            return { tekst: `Houd ${links ? "links" : "rechts"} aan bij de splitsing${naar}`, pijl: links ? "↖" : "↗" };
        case "end of road":
            return { tekst: `Sla aan het einde van de weg ${links ? "linksaf" : "rechtsaf"}${naar}`, pijl: links ? "←" : "→" };
        case "merge":
            return { tekst: `Voeg in${naar}`, pijl };
        case "new name":
        case "continue":
            if (modifier === "straight") return { tekst: weg ? `Ga verder op ${weg}` : "Ga rechtdoor", pijl };
            return { tekst: `${actie}${naar}`, pijl };
        default:
            return { tekst: `${actie}${naar}`, pijl };
    }
}

function formatAfstand(meter) {
    if (meter < 1000) return `${Math.max(10, Math.round(meter / 10) * 10)} m`;
    return `${(meter / 1000).toLocaleString("nl-NL", { maximumFractionDigits: meter < 10_000 ? 1 : 0 })} km`;
}

function spreekAfstand(meter) {
    if (meter < 1000) return `${Math.max(10, Math.round(meter / 10) * 10)} meter`;
    return `${(meter / 1000).toLocaleString("nl-NL", { maximumFractionDigits: 1 })} kilometer`;
}

function formatDuur(seconden) {
    const minuten = Math.max(1, Math.round(seconden / 60));
    if (minuten < 60) return `${minuten} min`;
    return `${Math.floor(minuten / 60)} u ${minuten % 60} min`;
}

function toonSamenvatting(afstand, duur) {
    document.getElementById("route-tijd").textContent = formatDuur(duur);
    document.getElementById("route-afstand").textContent = formatAfstand(afstand);
    const aankomst = new Date(Date.now() + duur * 1000);
    document.getElementById("route-aankomst").textContent =
        `aankomst ${aankomst.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`;
}

// --- Rekenen met routes ---

function afstandM([lat1, lng1], [lat2, lng2]) {
    return L.latLng(lat1, lng1).distanceTo([lat2, lng2]);
}

/** Maakt van een OSRM-route iets waar we makkelijk mee kunnen rekenen. */
function verrijkRoute(r) {
    const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + afstandM(coords[i - 1], coords[i]));
    const schaal = cum.at(-1) > 0 ? r.distance / cum.at(-1) : 1;

    const stappen = [];
    let positie = 0;
    let keerpunten = 0;
    r.legs.forEach((leg, li) => {
        // Bij een tussenpunt (omleiding) kan de route omkeren: dat melden we als aanwijzing
        if (li > 0) {
            const voor = r.legs[li - 1].steps.at(-1).maneuver.bearing_before;
            const na = leg.steps[0].maneuver.bearing_after;
            const verschil = Math.abs(((na - voor + 540) % 360) - 180);
            if (verschil > 150) {
                keerpunten++;
                stappen.push({
                    tekst: "Keer om",
                    pijl: "↶",
                    afstand: 0,
                    positie,
                    locatie: L.latLng(leg.steps[0].maneuver.location[1], leg.steps[0].maneuver.location[0]),
                });
            }
        }
        for (const s of leg.steps) {
            const tussenpunt =
                (s.maneuver.type === "arrive" && li < r.legs.length - 1) || (s.maneuver.type === "depart" && li > 0);
            if (!tussenpunt) {
                stappen.push({
                    ...instructie(s),
                    afstand: s.distance,
                    positie,
                    locatie: L.latLng(s.maneuver.location[1], s.maneuver.location[0]),
                });
            }
            positie += s.distance;
        }
    });

    return { afstand: r.distance, duur: r.duration, coords, cum, schaal, stappen, keerpunten, blokkades: [], omleiding: false };
}

/** Kortste afstand van een punt tot de route, en waar op de route (meters vanaf de start). */
function puntOpRoute(p, route) {
    const { coords, cum } = route;
    const M = 111_320; // meter per breedtegraad
    const k = Math.cos((p.lat * Math.PI) / 180);
    let beste = { afstand: Infinity, positie: 0, index: 0 };
    if (coords.length === 1) return { afstand: p.distanceTo(coords[0]), positie: 0, index: 0 };

    for (let i = 0; i < coords.length - 1; i++) {
        const ax = (coords[i][1] - p.lng) * M * k;
        const ay = (coords[i][0] - p.lat) * M;
        const dx = (coords[i + 1][1] - p.lng) * M * k - ax;
        const dy = (coords[i + 1][0] - p.lat) * M - ay;
        const lengte2 = dx * dx + dy * dy;
        const t = lengte2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengte2)) : 0;
        const afstand = Math.hypot(ax + t * dx, ay + t * dy);
        if (afstand < beste.afstand) {
            beste = { afstand, positie: (cum[i] + t * (cum[i + 1] - cum[i])) * route.schaal, index: i };
        }
    }
    return beste;
}

const isDicht = (b) => b.melding.ernst === "hoog" && statusVan(b.melding) === "actief";

/** Actieve blokkades (en die binnen 2 uur beginnen) die op of vlak naast de route liggen. */
function blokkadesOpRoute(route) {
    const nu = new Date();
    // Tijdens het volgen: wat achter je ligt (of precies waar je staat) is niet meer relevant
    const vanaf = volgen && mijnLocatie ? puntOpRoute(mijnLocatie, route).positie + 30 : -Infinity;
    return meldingen
        .filter((m) => {
            const status = statusVan(m, nu);
            return status === "actief" || (status === "gepland" && new Date(m.start) - nu < 2 * 3600_000);
        })
        .map((m) => ({ melding: m, ...puntOpRoute(L.latLng(m.lat, m.lng), route) }))
        .filter((b) => b.afstand <= (Number(b.melding.straal) || 0) + 25 && b.positie > vanaf)
        .sort((a, b) => a.positie - b.positie);
}

// Afsluitingen wegen zwaar, andere blokkades tellen als 10 minuten extra, omkeren als 15 minuten
function routeScore(r) {
    return r.blokkades.filter(isDicht).length * 1e6 + r.blokkades.length * 600 + r.keerpunten * 900 + r.duur;
}

async function haalRoutes(punten, profiel) {
    const coords = punten.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const url =
        `https://routing.openstreetmap.de/${profiel}/route/v1/driving/${coords}` +
        `?overview=full&geometries=geojson&steps=true&alternatives=${punten.length === 2}`;
    const antwoord = await fetch(url);
    if (!antwoord.ok) throw new Error(`Routeserver gaf ${antwoord.status}`);
    const data = await antwoord.json();
    return data.code === "Ok" ? data.routes.map(verrijkRoute) : [];
}

/**
 * OSRM kan geen gebieden vermijden. Daarom proberen we een omleiding via tussenpunten
 * links en rechts van de afsluiting.
 */
async function zoekOmleiding(route, profiel, van, naar) {
    const afsluiting = route.blokkades.find(isDicht);
    const m = afsluiting.melding;
    const a = route.coords[Math.max(0, afsluiting.index - 3)];
    const b = route.coords[Math.min(route.coords.length - 1, afsluiting.index + 4)];
    const k = Math.cos((m.lat * Math.PI) / 180);
    let dx = (b[1] - a[1]) * k;
    let dy = b[0] - a[0];
    const lengte = Math.hypot(dx, dy) || 1;
    dx /= lengte;
    dy /= lengte;

    const basis = Math.max((Number(m.straal) || 0) * 1.5, 250);
    const tussenpunten = [];
    for (const factor of [1, 3]) {
        for (const kant of [1, -1]) {
            const graden = (basis * factor * kant) / 111_320;
            tussenpunten.push(L.latLng(m.lat + dx * graden, m.lng - (dy * graden) / k));
        }
    }
    const resultaten = await Promise.allSettled(tussenpunten.map((t) => haalRoutes([van, t, naar], profiel)));
    return resultaten.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).map((r) => ({ ...r, omleiding: true }));
}

/**
 * Een tussenpunt in een zijstraat geeft soms een onnodig lusje (heen en weer door een blok).
 * Vind zo'n lus: twee punten die dicht bij elkaar liggen, maar ver uit elkaar langs de route.
 */
function vindLus(route) {
    const { coords, cum } = route;
    for (let i = 0; i < coords.length; i++) {
        for (let j = Math.min(coords.length - 1, i + 400); j > i; j--) {
            const langs = cum[j] - cum[i];
            if (langs < 150) break;
            const recht = afstandM(coords[i], coords[j]);
            if (recht < 40 && langs > 4 * recht) return [coords[i], coords[j]];
        }
    }
    return null;
}

async function zonderLus(route, profiel, van, naar) {
    const lus = vindLus(route);
    if (!lus) return null;
    const [nieuw] = await haalRoutes([van, L.latLng(lus[0]), L.latLng(lus[1]), naar], profiel);
    return nieuw ? { ...nieuw, omleiding: true } : null;
}

function gebruikersFout(tekst) {
    return Object.assign(new Error(tekst), { gebruikersTekst: tekst });
}

/** Zoekt de coördinaten bij het van- of naar-veld. */
async function bepaalPunt(veld, input) {
    const tekst = input.value.trim();
    const gekozen = routePunten[veld];
    if (gekozen && gekozen.label === tekst) return gekozen.latlng;

    if (!tekst) {
        if (veld === "van") return vraagLocatie(); // leeg vertrekpunt = mijn locatie
        input.focus();
        throw gebruikersFout("Waar wil je heen? Vul een bestemming in of kies een punt op de kaart.");
    }
    const plek = await zoekPlek(tekst);
    if (!plek) {
        input.focus();
        throw gebruikersFout(`Geen plek gevonden voor "${tekst}". Probeer een andere schrijfwijze.`);
    }
    const latlng = L.latLng(plek.lat, plek.lon);
    routePunten[veld] = { latlng, label: tekst };
    return latlng;
}

const gekozenVervoer = () => routeForm.querySelector('input[name="vervoer"]:checked').value;

async function planRoute({ vanaf = null, stil = false } = {}) {
    if (routeBezig) return;
    routeBezig = true;
    routePlanKnop.disabled = true;
    routePlanKnop.textContent = "Route zoeken…";

    try {
        const van = vanaf || (await bepaalPunt("van", routeVanInput));
        const naar = await bepaalPunt("naar", routeNaarInput);
        const profiel = ROUTE_PROFIELEN[gekozenVervoer()];

        let routes = await haalRoutes([van, naar], profiel);
        if (!routes.length) throw gebruikersFout("Er is geen route gevonden tussen deze punten.");
        routes.forEach((r) => (r.blokkades = blokkadesOpRoute(r)));

        // Gaan alle routes door een afsluiting? Probeer er omheen te rijden.
        if (routes.every((r) => r.blokkades.some(isDicht))) {
            const snelste = routes[0];
            const omleidingen = await zoekOmleiding(snelste, profiel, van, naar).catch(() => []);
            for (const o of omleidingen) {
                o.blokkades = blokkadesOpRoute(o);
                const dubbel = routes.some((r) => Math.abs(r.afstand - o.afstand) < r.afstand * 0.01);
                if (!dubbel && o.duur < snelste.duur * 3) routes.push(o);
            }

            // De beste omleidingen ontdoen van lusjes
            routes.sort((a, b) => routeScore(a) - routeScore(b));
            const metLus = routes.filter((r) => r.omleiding).slice(0, 2);
            const opgeschoond = await Promise.all(metLus.map((r) => zonderLus(r, profiel, van, naar).catch(() => null)));
            opgeschoond.forEach((o, i) => {
                if (!o) return;
                o.blokkades = blokkadesOpRoute(o);
                // Beter dan het origineel? Dan vervangt hij die.
                if (routeScore(o) < routeScore(metLus[i])) routes[routes.indexOf(metLus[i])] = o;
            });
        }

        routes.sort((a, b) => routeScore(a) - routeScore(b));
        routeOpties = routes.slice(0, 3);
        kiesRoute(0, { zoom: !stil });
    } catch (err) {
        if (err.gebruikersTekst) {
            toast(err.gebruikersTekst, "info");
        } else if (err?.PERMISSION_DENIED === 1 || err.message === "geen geolocatie") {
            // Melding over de locatie is al getoond
            routeVanInput.focus();
        } else {
            console.error(err);
            toast("De route kon niet berekend worden. Controleer je internetverbinding en probeer opnieuw.", "fout");
        }
    } finally {
        routeBezig = false;
        routePlanKnop.disabled = false;
        routePlanKnop.textContent = "Route zoeken";
    }
}

// --- Tekenen en tonen ---

function kiesRoute(index, { zoom = true } = {}) {
    actieveRoute = routeOpties[index];
    huidigeStap = -1;
    tekenRoutes();
    toonRouteInfo();
    if (zoom) {
        const opties =
            innerWidth > 760
                ? { paddingTopLeft: [410, 40], paddingBottomRight: [100, 40] }
                : { paddingTopLeft: [20, 90], paddingBottomRight: [70, routePaneel.offsetHeight + 24] };
        map.fitBounds(L.latLngBounds(actieveRoute.coords), opties);
    }
    if (volgen) volgUpdate();
}

function tekenRoutes() {
    routeLaag.clearLayers();
    routeOpties.forEach((r, i) => {
        if (r === actieveRoute) return;
        L.polyline(r.coords, { color: "#8d9bbb", weight: 7, opacity: 0.75, bubblingMouseEvents: false })
            .bindTooltip(`${formatDuur(r.duur)} · ${formatAfstand(r.afstand)}`, { sticky: true })
            .on("click", () => kiesRoute(i, { zoom: false }))
            .addTo(routeLaag);
    });

    const r = actieveRoute;
    const kleur = r.blokkades.some(isDicht) ? "#e5294a" : "#0342df";
    L.polyline(r.coords, { color: "#fff", weight: 12, interactive: false }).addTo(routeLaag);
    L.polyline(r.coords, { color: kleur, weight: 7, interactive: false }).addTo(routeLaag);

    L.circleMarker(r.coords[0], {
        radius: 7, color: "#fff", weight: 3, fillColor: "#051736", fillOpacity: 1, interactive: false,
    }).addTo(routeLaag);
    L.marker(r.coords.at(-1), {
        icon: L.divIcon({ className: "", html: '<div class="route-doel">🏁</div>', iconSize: [36, 36], iconAnchor: [18, 18] }),
        interactive: false,
    }).addTo(routeLaag);
}

function toonRouteInfo() {
    const r = actieveRoute;
    routeResultaat.hidden = false;
    toonSamenvatting(r.afstand, r.duur);
    toonRouteWaarschuwing();
    routeStappenLijst.innerHTML = r.stappen
        .map(
            (s, i) => `
            <li data-stap="${i}">
                <span class="stap-pijl">${s.pijl}</span>
                <span class="stap-tekst">${escapeHtml(s.tekst)}</span>
                <span class="stap-afstand">${s.afstand ? formatAfstand(s.afstand) : ""}</span>
            </li>`
        )
        .join("");
}

function toonRouteWaarschuwing() {
    const r = actieveRoute;
    const snelsteDuur = Math.min(...routeOpties.map((o) => o.duur));
    const ietsOmzeild = routeOpties.some((o) => o.blokkades.some(isDicht)) && !r.blokkades.some(isDicht);
    let html = "";

    if (r.blokkades.length) {
        const dicht = r.blokkades.some(isDicht);
        const n = r.blokkades.length;
        const items = r.blokkades
            .map((b) => {
                const m = b.melding;
                const wanneer = statusVan(m) === "gepland" ? `vanaf ${formatDatum(m.start)}` : "nu";
                return `<li><button type="button" data-blokkade="${m.id}">
                    <span>${(TYPES[m.type] || TYPES.overig).icoon}</span>
                    <span><b>${escapeHtml(m.titel)}</b><small>${ERNST[m.ernst].label} · ${wanneer}</small></span>
                </button></li>`;
            })
            .join("");
        html += `
            <div class="route-melding ${dicht ? "route-melding-gevaar" : "route-melding-letop"}">
                <strong>${dicht ? "⛔ Je route gaat door een afsluiting" : `⚠️ ${n} ${n === 1 ? "blokkade" : "blokkades"} op je route`}</strong>
                <ul>${items}</ul>
                ${dicht ? "<p>We vonden geen route er omheen. Kijk bij de melding of er een omleiding is.</p>" : ""}
            </div>`;
    } else {
        html += `<div class="route-melding route-melding-ok"><strong>✅ Geen blokkades op je route</strong></div>`;
    }

    if (ietsOmzeild) {
        const extra = Math.round((r.duur - snelsteDuur) / 60);
        html += `<p class="route-noot">↪️ We sturen je om een afsluiting heen${extra > 0 ? ` (+${extra} min)` : ""}.</p>`;
    }
    if (routeOpties.length > 1 && !volgen) {
        html += `<p class="route-noot">Tik op een grijze lijn op de kaart voor een andere route.</p>`;
    }
    routeWaarschuwing.innerHTML = html;
}

// Meldingen veranderd (of een minuut verder): blokkades op de route opnieuw bepalen
function routeBlokkadesBijwerken() {
    if (!actieveRoute) return;
    routeOpties.forEach((r) => (r.blokkades = blokkadesOpRoute(r)));
    tekenRoutes();
    toonRouteWaarschuwing();
}

function wisRoute() {
    routeLaag.clearLayers();
    routeOpties = [];
    actieveRoute = null;
    routeResultaat.hidden = true;
}

// --- Paneel ---

function openRoutePaneel() {
    zetPlaatsModus(false);
    routePaneel.hidden = false;
    meldPaneel.hidden = true;
    btnRoute.classList.add("actief");
}

function sluitRoutePaneel() {
    stopVolgen();
    wisRoute();
    routeForm.reset();
    routePunten.van = routePunten.naar = null;
    routePaneel.hidden = true;
    meldPaneel.hidden = false;
    btnRoute.classList.remove("actief");
}

/** Plan een route naar een punt (vanuit popups op de kaart). */
function routeNaar(latlng, label) {
    openRoutePaneel();
    routePunten.naar = { latlng, label };
    routeNaarInput.value = label;
    planRoute();
}

btnRoute.addEventListener("click", () => {
    if (routePaneel.hidden) {
        openRoutePaneel();
        routeNaarInput.focus();
    } else {
        sluitRoutePaneel();
    }
});
document.getElementById("btn-route-sluit").addEventListener("click", sluitRoutePaneel);

routeForm.addEventListener("submit", (e) => {
    e.preventDefault();
    planRoute();
});

// Ander vervoer gekozen: meteen opnieuw berekenen
routeForm.addEventListener("change", (e) => {
    if (e.target.name === "vervoer" && actieveRoute) planRoute({ stil: volgen, vanaf: volgen ? mijnLocatie : null });
});

document.getElementById("btn-route-wissel").addEventListener("click", () => {
    let van = routePunten.van;
    let vanTekst = routeVanInput.value.trim();
    if (!vanTekst) {
        if (!mijnLocatie) {
            toast("Vul eerst een vertrekpunt in, of zet je locatie aan.", "info");
            return;
        }
        van = { latlng: mijnLocatie, label: "Mijn locatie" };
        vanTekst = "Mijn locatie";
    }
    const naarTekst = routeNaarInput.value.trim();
    routePunten.van = routePunten.naar && routePunten.naar.label === naarTekst ? routePunten.naar : null;
    routePunten.naar = van && van.label === vanTekst ? van : null;
    routeVanInput.value = naarTekst;
    routeNaarInput.value = vanTekst;
    if (actieveRoute) planRoute();
});

routeStappenLijst.addEventListener("click", (e) => {
    const li = e.target.closest("[data-stap]");
    if (!li || !actieveRoute) return;
    if (volgen) volgKaartMee = false;
    map.setView(actieveRoute.stappen[li.dataset.stap].locatie, 17);
});

routeWaarschuwing.addEventListener("click", (e) => {
    const knop = e.target.closest("[data-blokkade]");
    if (!knop) return;
    const melding = meldingen.find((m) => m.id === knop.dataset.blokkade);
    if (!melding) return;
    if (volgen) volgKaartMee = false;
    map.setView([melding.lat, melding.lng], 17);
    markers.get(melding.id)?.openPopup();
});

// --- Route volgen ---

function spreek(tekst) {
    if (!geluidAan || !("speechSynthesis" in window)) return;
    const uiting = new SpeechSynthesisUtterance(tekst);
    uiting.lang = "nl-NL";
    const stem = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith("nl"));
    if (stem) uiting.voice = stem;
    speechSynthesis.speak(uiting);
}

// Scherm aan houden tijdens het volgen (waar de browser dat ondersteunt)
async function houdSchermAan() {
    try {
        schermSlot = await navigator.wakeLock?.request("screen");
    } catch {
        schermSlot = null;
    }
}

document.addEventListener("visibilitychange", () => {
    if (volgen && document.visibilityState === "visible") houdSchermAan();
});

async function startVolgen() {
    if (!actieveRoute) return;
    btnVolgen.disabled = true;
    try {
        await vraagLocatie();
    } catch {
        return; // melding over de locatie is al getoond
    } finally {
        btnVolgen.disabled = false;
    }

    volgen = true;
    volgKaartMee = true;
    huidigeStap = -1;
    gewaarschuwd.clear();
    document.body.classList.add("volg-modus");
    zetPlaatsModus(false);
    zetMeldKnop(true);
    btnVolgen.textContent = "■ Stoppen";
    btnVolgen.classList.replace("btn-primary", "btn-gevaar-vol");
    navStap.hidden = false;
    toonRouteWaarschuwing();
    houdSchermAan();

    map.setView(mijnLocatie, 17);
    volgUpdate();
}

function stopVolgen({ stil = false } = {}) {
    if (!volgen) return;
    volgen = false;
    document.body.classList.remove("volg-modus");
    zetMeldKnop(false);
    btnVolgen.textContent = "▶ Route volgen";
    btnVolgen.classList.replace("btn-gevaar-vol", "btn-primary");
    navStap.hidden = true;
    routeStappenLijst.querySelector(".nu")?.classList.remove("nu");
    if (!stil && "speechSynthesis" in window) speechSynthesis.cancel();
    schermSlot?.release().catch(() => {});
    schermSlot = null;
    if (actieveRoute) {
        toonSamenvatting(actieveRoute.afstand, actieveRoute.duur);
        toonRouteWaarschuwing();
    }
}

/** Wordt bij elke nieuwe locatie aangeroepen terwijl je een route volgt. */
function volgUpdate(nauwkeurigheid = 0) {
    if (!volgen || !actieveRoute || !mijnLocatie) return;
    const r = actieveRoute;
    const plek = puntOpRoute(mijnLocatie, r);

    if (volgKaartMee) map.panTo(mijnLocatie, { animate: true });

    // Aangekomen?
    if (mijnLocatie.distanceTo(r.coords.at(-1)) < 30 || (r.afstand - plek.positie < 25 && plek.afstand < 40)) {
        spreek("Je bent op je bestemming.");
        toast("Je bent er! 🏁", "succes");
        stopVolgen({ stil: true });
        return;
    }

    // Van de route af? Dan opnieuw berekenen vanaf hier (hooguit eens per 15 seconden)
    const marge = Math.max(50, Math.min(nauwkeurigheid, 100));
    if (plek.afstand > marge && Date.now() - laatsteHerberekening > 15_000) {
        laatsteHerberekening = Date.now();
        toast("Je bent van de route af. We berekenen een nieuwe route…", "info", 3000);
        spreek("Nieuwe route wordt berekend.");
        planRoute({ vanaf: mijnLocatie, stil: true });
        return;
    }

    // Resterende afstand en tijd
    const rest = Math.max(0, r.afstand - plek.positie);
    toonSamenvatting(rest, r.afstand ? (r.duur * rest) / r.afstand : 0);

    // Volgende aanwijzing
    let k = r.stappen.findIndex((s, i) => i > 0 && s.positie > plek.positie + 5);
    if (k === -1) k = r.stappen.length - 1;
    const stap = r.stappen[k];
    const totStap = Math.max(0, stap.positie - plek.positie);
    const drempel = NU_DREMPEL[gekozenVervoer()];

    document.getElementById("nav-pijl").textContent = stap.pijl;
    document.getElementById("nav-afstand").textContent = totStap < 15 ? "Nu" : `Over ${formatAfstand(totStap)}`;
    document.getElementById("nav-tekst").textContent = stap.tekst;

    if (k !== huidigeStap) {
        huidigeStap = k;
        nuGezegd = totStap <= drempel;
        routeStappenLijst.querySelector(".nu")?.classList.remove("nu");
        const li = routeStappenLijst.querySelector(`[data-stap="${k}"]`);
        li?.classList.add("nu");
        li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        const zin = stap.tekst.charAt(0).toLowerCase() + stap.tekst.slice(1);
        spreek(totStap > drempel ? `Over ${spreekAfstand(totStap)}, ${zin}.` : `${stap.tekst}.`);
    } else if (!nuGezegd && totStap <= drempel) {
        nuGezegd = true;
        spreek(`${stap.tekst}.`);
    }

    // Waarschuwen voor blokkades die eraan komen
    for (const b of r.blokkades) {
        const vooruit = b.positie - plek.positie;
        if (vooruit > -20 && vooruit < 600 && !gewaarschuwd.has(b.melding.id)) {
            gewaarschuwd.add(b.melding.id);
            const waar = vooruit < 50 ? "Hier" : `Over ${formatAfstand(vooruit)}`;
            toast(`${waar}: ${b.melding.titel} (${ERNST[b.melding.ernst].label.toLowerCase()})`, "fout", 8000);
            spreek(`Let op! ${vooruit < 50 ? "Hier" : `Over ${spreekAfstand(vooruit)}`}: ${b.melding.titel}.`);
        }
    }
}

btnVolgen.addEventListener("click", () => (volgen ? stopVolgen() : startVolgen()));

btnGeluid.addEventListener("click", () => {
    geluidAan = !geluidAan;
    btnGeluid.textContent = geluidAan ? "🔊" : "🔇";
    btnGeluid.setAttribute("aria-pressed", geluidAan);
    if (!geluidAan && "speechSynthesis" in window) speechSynthesis.cancel();
});

// Zelf de kaart verschuiven tijdens het volgen: niet meer automatisch meebewegen
// (de locatieknop zet het weer aan)
map.on("dragstart", () => {
    if (volgen) volgKaartMee = false;
});

// ---------- Hier melden (tijdens het volgen van een route) ----------
// Opent het gewone meldformulier op de plek waar je was toen je op de knop drukte.

/** Straatnaam en plaats bij een punt (OpenStreetMap). */
async function wegnaamBij(punt) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${punt.lat}&lon=${punt.lng}`;
        const { address: a = {} } = await (await fetch(url, { headers: { "Accept-Language": "nl" } })).json();
        const weg = a.road || a.pedestrian || a.cycleway || a.footway || a.path;
        const plaats = a.village || a.town || a.city || a.municipality;
        return weg ? [weg, plaats].filter(Boolean).join(", ") : null;
    } catch {
        return null;
    }
}

async function openSnelMelding() {
    let hier;
    try {
        const p = await vraagLocatie();
        hier = L.latLng(p.lat, p.lng);
    } catch {
        return; // melding over de locatie is al getoond
    }
    openFormulier(hier);
    document.getElementById("dialoog-titel").textContent = "Hier melden";
    const locatieTekst = document.getElementById("locatie-tekst");
    locatieTekst.textContent = "Op je huidige locatie";

    const naam = await wegnaamBij(hier);
    if (naam && dialoog.open && gekozenLocatie === hier) locatieTekst.textContent = naam;
}

// ---------- Start ----------

render();
// Status (gepland → actief → verlopen) elke minuut bijwerken
setInterval(render, 60_000);
