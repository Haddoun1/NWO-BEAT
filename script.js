// NWO BEAT – barrières op de kaart (Leaflet + OpenStreetMap)

// ---------- Instellingen ----------

const AMSTERDAM = [52.3676, 4.9041];
// Gemeente Amsterdam (met een kleine marge): [[zuid, west], [noord, oost]]
const AMSTERDAM_GRENZEN = [[52.27, 4.72], [52.44, 5.09]];
const OPSLAG_SLEUTEL = "nwo-beat-meldingen";
const ROUTES_SLEUTEL = "nwo-beat-routes";

// Impact van een barrière: 1 = een beetje lastig … 5 = dit lukt me helemaal niet
const IMPACT = {
    1: { emoji: "🙂", kleur: "#f5b400" },
    2: { emoji: "😐", kleur: "#f59400" },
    3: { emoji: "😕", kleur: "#ff6631" },
    4: { emoji: "😣", kleur: "#e5294a" },
    5: { emoji: "😫", kleur: "#a3122f" },
};
const IMPACT_UITLEG = { 1: "Een beetje lastig", 5: "Dit lukt me helemaal niet" };
const DUUR_LABEL = { permanent: "Permanent", tijdelijk: "Tijdelijk" };
const impactVan = (m) => IMPACT[m.impact] || IMPACT[3];

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
const bevestigInvoer = document.getElementById("bevestig-invoer");

function bevestig({ titel, tekst = "", okTekst = "OK", annuleerTekst = "Annuleren", icoon = "❓", gevaar = false }) {
    bevestigInvoer.hidden = true;
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

/** Zelfde venster, maar met een tekstveld. Geeft de ingevulde tekst terug, of null bij annuleren. */
async function vraagTekst({ titel, tekst = "", waarde = "", placeholder = "", okTekst = "OK", icoon = "✏️" }) {
    const klaar = bevestig({ titel, tekst, okTekst, icoon });
    bevestigInvoer.hidden = false;
    bevestigInvoer.value = waarde;
    bevestigInvoer.placeholder = placeholder;
    bevestigInvoer.focus();
    bevestigInvoer.select();
    const ok = await klaar;
    bevestigInvoer.hidden = true;
    return ok ? bevestigInvoer.value.trim() : null;
}

// Enter in het tekstveld = OK (anders zou de eerste knop, Annuleren, het formulier versturen)
bevestigInvoer.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    bevestigDialoog.close("ok");
});

// Klik op de achtergrond = annuleren
bevestigDialoog.addEventListener("click", (e) => {
    if (e.target === bevestigDialoog) bevestigDialoog.close("annuleer");
});

// ---------- Kaart ----------

const map = L.map("map", {
    zoomControl: false,
    maxBounds: AMSTERDAM_GRENZEN,
    maxBoundsViscosity: 1.0, // niet buiten Amsterdam kunnen slepen
    minZoom: 11,
}).setView(AMSTERDAM, 12);
L.control.zoom({ position: "topright", zoomInTitle: "Inzoomen", zoomOutTitle: "Uitzoomen" }).addTo(map);

L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers',
}).addTo(map);

L.control.scale({ imperial: false, position: "bottomleft" }).addTo(map);

const meldingLaag = L.layerGroup().addTo(map);

// ---------- Opslag (voorlopig alleen in deze browser) ----------

function laadMeldingen() {
    let lijst;
    try {
        lijst = JSON.parse(localStorage.getItem(OPSLAG_SLEUTEL)) || [];
    } catch {
        return [];
    }
    // Meldingen van vóór de barrièrekaart omzetten (titel/ernst/datums → barrièrevelden)
    let volgende = Math.max(0, ...lijst.map((m) => Number(m.nr) || 0)) + 1;
    return lijst.map((m) => {
        if (m.wat !== undefined) return m;
        return {
            id: m.id,
            nr: volgende++,
            wat: m.titel || "",
            locatie: m.adres || "",
            duur: m.eind ? "tijdelijk" : "permanent",
            waarom: m.omschrijving || "",
            impact: { laag: 2, middel: 3, hoog: 5 }[m.ernst] || 3,
            oplossing: m.omleiding || "",
            fotos: m.fotos || [],
            lat: m.lat,
            lng: m.lng,
            adres: m.adres || null,
            aangemaakt: m.aangemaakt || m.start,
            bijgewerkt: m.bijgewerkt,
        };
    });
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

/** fetch, maar geeft na `ms` milliseconden op (met een duidelijke fout). */
async function fetchMetTimeout(url, ms, opties = {}) {
    const stop = new AbortController();
    const klok = setTimeout(() => stop.abort(), ms);
    try {
        return await fetch(url, { ...opties, signal: stop.signal });
    } catch (err) {
        if (err.name === "AbortError") throw Object.assign(new Error("timeout"), { timeout: true });
        throw err;
    } finally {
        clearTimeout(klok);
    }
}

function escapeHtml(tekst = "") {
    return String(tekst).replace(/[&<>"']/g, (c) => HTML_TEKENS[c]);
}

function formatDatum(iso) {
    if (!iso) return "onbekend";
    return new Date(iso).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" });
}

function maakIcoon(m) {
    const klassen = ["marker", m.duur === "tijdelijk" ? "marker-tijdelijk" : "", m.impact >= 5 ? "marker-puls" : ""];
    return L.divIcon({
        className: "",
        html: `<div class="${klassen.filter(Boolean).join(" ")}" style="--kleur:${impactVan(m).kleur}"><span>${m.nr ?? "?"}</span></div>`,
        iconSize: [40, 40],
        iconAnchor: [20, 40],
        popupAnchor: [0, -38],
    });
}

function popupHtml(m) {
    const impact = impactVan(m);
    const regel = (label, waarde) => (waarde ? `<dt>${label}</dt><dd>${escapeHtml(waarde)}</dd>` : "");
    return `
        <div class="popup">
            <div class="popup-kop" style="--kleur:${impact.kleur}">
                <span class="popup-icoon">${impact.emoji}</span>
                <div>
                    <p class="popup-type">Barrière nr. ${escapeHtml(m.nr ?? "?")}</p>
                    <h3>${escapeHtml(m.wat)}</h3>
                </div>
            </div>
            <div class="popup-badges">
                <span class="badge" style="background:${impact.kleur}">Impact ${m.impact}/5</span>
                ${m.duur ? `<span class="badge badge-${m.duur}">${DUUR_LABEL[m.duur]}</span>` : ""}
            </div>
            ${fotosHtml(m)}
            <dl>
                ${regel("Locatie", m.locatie || m.adres)}
                ${regel("Waarom", m.waarom)}
                ${regel("Oplossing", m.oplossing)}
                ${regel("Gemeld", m.aangemaakt ? formatDatum(m.aangemaakt) : "")}
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

// Impact-keuze (1 t/m 5) in het formulier
document.getElementById("impact-keuze").innerHTML = Object.entries(IMPACT)
    .map(
        ([n, i]) => `
        <label class="impact-optie" style="--e:${i.kleur}">
            <input type="radio" name="impact" value="${n}" aria-label="Impact ${n}${IMPACT_UITLEG[n] ? `: ${IMPACT_UITLEG[n]}` : ""}">
            <span><span class="impact-emoji">${i.emoji}</span><b>${n}</b></span>
        </label>`
    )
    .join("");

function actieveDuren() {
    return [...document.querySelectorAll('.filters input[name="duur"]:checked')].map((el) => el.value);
}

document.querySelector(".filters").addEventListener("change", render);

// ---------- Weergave ----------

const markers = new Map(); // id -> marker

function render() {
    meldingLaag.clearLayers();
    markers.clear();

    const duren = actieveDuren();
    const zichtbaar = meldingen
        .filter((m) => !m.duur || duren.includes(m.duur))
        .sort((a, b) => (Number(a.nr) || 0) - (Number(b.nr) || 0));

    for (const m of zichtbaar) {
        const marker = L.marker([m.lat, m.lng], { icon: maakIcoon(m), title: `Barrière ${m.nr}: ${m.wat}` })
            .bindPopup(popupHtml(m), { maxWidth: 300 })
            .addTo(meldingLaag);
        markers.set(m.id, marker);
    }

    routeBlokkadesBijwerken();
}

// ---------- Barrière melden / bewerken (de barrièrekaart) ----------

const dialoog = document.getElementById("dialoog");
const form = document.getElementById("melding-form");
const plaatsHint = document.getElementById("plaats-hint");

let bewerkId = null;
let gekozenLocatie = null;
let gekozenAdres = null; // adres bij gekozenLocatie, zodra het gevonden is

/** Adres bij een punt (OpenStreetMap), bijv. "Damrak 12, Amsterdam". Geeft null als het niet lukt. */
async function adresBij(punt) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${punt.lat}&lon=${punt.lng}`;
        const antwoord = await fetchMetTimeout(url, 6_000, { headers: { "Accept-Language": "nl" } });
        const { address: a = {} } = await antwoord.json();
        const weg = a.road || a.pedestrian || a.cycleway || a.footway || a.path || a.square;
        const plaats = a.city || a.town || a.village || a.municipality;
        const straat = weg ? [weg, a.house_number].filter(Boolean).join(" ") : a.neighbourhood || a.suburb;
        return straat ? [straat, plaats].filter(Boolean).join(", ") : null;
    } catch {
        return null;
    }
}

/** Vult het locatieveld met het adres (als het nog leeg is); zoekt het adres zo nodig op. */
async function vulLocatieAdres(latlng, bekendAdres = null) {
    const veld = form.elements.locatie;
    gekozenAdres = bekendAdres;
    if (bekendAdres) return;
    veld.placeholder = "Adres zoeken…";
    const adres = await adresBij(latlng);
    if (gekozenLocatie !== latlng) return; // intussen een andere plek gekozen
    gekozenAdres = adres;
    veld.placeholder = "Bijv. bij de ingang van het station";
    if (adres && !veld.value.trim()) veld.value = adres;
}

/** Eerstvolgende vrije barrièrenummer. */
const volgendNr = () => Math.max(0, ...meldingen.map((m) => Number(m.nr) || 0)) + 1;

let plaatsModus = false;

function openFormulier(latlng, melding = null) {
    form.reset();
    bewerkId = melding ? melding.id : null;
    gekozenLocatie = latlng;

    if (melding) {
        for (const [veld, waarde] of Object.entries(melding)) {
            const el = form.elements[veld];
            if (el && waarde != null) el.value = waarde;
        }
    } else {
        form.elements.nr.value = volgendNr();
    }
    vulLocatieAdres(latlng, melding?.adres);

    huidigeFotos = melding?.fotos ? [...melding.fotos] : [];
    renderFotoPreview();

    wisFouten();
    formGewijzigd = false;

    map.closePopup();
    dialoog.showModal();
    dialoog.querySelector(".dialoog-inhoud").scrollTop = 0;
}

// ---------- Eigen formuliercontrole (i.p.v. Chrome-ballonnetjes) ----------

let formGewijzigd = false;

function wisFouten() {
    form.querySelectorAll(".veld-fout").forEach((el) => el.remove());
    form.querySelectorAll(".ongeldig").forEach((el) => el.classList.remove("ongeldig"));
}

function toonVeldFout(veld, tekst) {
    // Bij radioknoppen/tegels de hele groep markeren, anders het veld zelf
    const houder = veld.closest(".impact-keuze, .duur-keuze") || veld.closest(".dicteer-veld") || veld;
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
    if (!data.wat?.trim()) fouten.push([form.elements.wat, "Beschrijf kort wat de barrière is."]);
    if (!data.impact) fouten.push([form.querySelector('input[name="impact"]'), "Kies hoeveel last je ervan hebt."]);

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
        // randomUUID bestaat alleen op https/localhost; op je telefoon via http://192.168… niet
        id: bewerkId || crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
        nr: Number(data.nr) || volgendNr(),
        wat: data.wat.trim(),
        locatie: data.locatie.trim(),
        duur: data.duur || null,
        waarom: data.waarom.trim(),
        impact: Number(data.impact),
        oplossing: data.oplossing.trim(),
        lat: gekozenLocatie.lat,
        lng: gekozenLocatie.lng,
        adres: gekozenAdres,
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
        toast("Opslaan mislukt: de opslag in deze browser is vol. Verwijder een paar foto's of oude barrières en probeer het opnieuw.", "fout", 8000);
        return;
    }

    dialoog.close();
    render();
    markers.get(melding.id)?.openPopup();
    toast(bewerkId ? "Barrière bijgewerkt" : "Barrière opgeslagen — bedankt!", "succes", 3000);
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
        <button class="btn btn-primary btn-klein" type="button" data-kies="melden">📍 Barrière hier melden</button>
        <button class="btn btn-licht btn-klein" type="button" data-kies="route">🧭 Route hierheen</button>
        ${actieveRoute ? '<button class="btn btn-licht btn-klein" type="button" data-kies="stop">➕ Als tussenstop</button>' : ""}`;
    inhoud.querySelector('[data-kies="stop"]')?.addEventListener("click", () => {
        map.closePopup();
        stopOpKaart(e.latlng);
    });
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
    btnNieuw.setAttribute("aria-label", hier ? "Barrière melden op je huidige locatie" : "Barrière melden");
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
            routeNaar(L.latLng(melding.lat, melding.lng), `Barrière ${melding.nr}`);
        } else if (knop.dataset.actie === "bewerk") {
            openFormulier(L.latLng(melding.lat, melding.lng), melding);
        } else if (knop.dataset.actie === "verwijder") {
            bevestig({
                titel: "Barrière verwijderen?",
                tekst: `Barrière ${melding.nr} ("${melding.wat}") wordt definitief verwijderd. Dit kun je niet ongedaan maken.`,
                okTekst: "Ja, verwijderen",
                icoon: "🗑️",
                gevaar: true,
            }).then((ja) => {
                if (!ja) return;
                meldingen = meldingen.filter((m) => m.id !== melding.id);
                bewaarMeldingen();
                map.closePopup();
                render();
                toast("Barrière verwijderd", "succes", 3000);
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
        <button class="btn btn-primary btn-klein" type="button">📍 Barrière hier melden</button>`;
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
const plekCache = new Map(); // zoekterm -> resultaat

async function zoekPlek(zoekterm) {
    const sleutel = zoekterm.toLowerCase();
    if (plekCache.has(sleutel)) return plekCache.get(sleutel);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=nl&viewbox=${AMSTERDAM_GRENZEN[0][1]},${AMSTERDAM_GRENZEN[1][0]},${AMSTERDAM_GRENZEN[1][1]},${AMSTERDAM_GRENZEN[0][0]}&bounded=1&q=${encodeURIComponent(zoekterm)}`;
    const antwoord = await fetchMetTimeout(url, 10_000, { headers: { "Accept-Language": "nl" } });
    const resultaten = await antwoord.json();
    const plek = resultaten[0] || null;
    if (plek) plekCache.set(sleutel, plek);
    return plek;
}

document.getElementById("zoek-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const zoekterm = document.getElementById("zoek-input").value.trim();
    if (!zoekterm) return;

    try {
        const plek = await zoekPlek(zoekterm);
        if (!plek) {
            toast(`Geen plek in Amsterdam gevonden voor "${zoekterm}". Probeer een andere schrijfwijze.`, "info");
            return;
        }
        const { lat, lon, boundingbox, display_name } = plek;
        const [zuid, noord, west, oost] = boundingbox.map(Number);
        toonGevondenPlek(L.latLng(lat, lon), display_name.split(",")[0], display_name, [[zuid, west], [noord, oost]]);
    } catch (err) {
        console.error(err);
        toast("Zoeken mislukt. Controleer je internetverbinding.", "fout");
    }
});

/** Gevonden plek op de kaart laten zien, met een knop om er een route naartoe te plannen. */
function toonGevondenPlek(latlng, naam, omschrijving, grenzen = null) {
    if (grenzen) map.fitBounds(grenzen, { maxZoom: 17 });
    else map.setView(latlng, Math.max(map.getZoom(), 17));

    const inhoud = document.createElement("div");
    inhoud.className = "popup-knoppen-stapel";
    inhoud.innerHTML = `<p>${escapeHtml(omschrijving)}</p>
        <button class="btn btn-primary btn-klein" type="button">🧭 Route hierheen</button>`;
    inhoud.querySelector("button").addEventListener("click", () => {
        map.closePopup();
        routeNaar(latlng, naam);
    });
    L.popup().setLatLng(latlng).setContent(inhoud).openOn(map);
}

// ---------- Adressuggesties tijdens het typen (Photon / OpenStreetMap) ----------
// Nominatim staat zoeken-tijdens-typen niet toe; Photon (van Komoot) is daar juist voor gemaakt.

const suggestieCache = new Map(); // zoekterm -> resultaten
const suggestieLijst = document.createElement("ul");
suggestieLijst.id = "suggesties";
suggestieLijst.className = "suggesties";
suggestieLijst.setAttribute("role", "listbox");
suggestieLijst.hidden = true;
document.body.append(suggestieLijst);

// Het veld waar de lijst nu onder staat: { input, onKies, resultaten, actief }
let suggestieVeld = null;

/** Maakt van een Photon-resultaat een titel (wat in het veld komt) en een regel met details. */
function beschrijfPlek(f) {
    const p = f.properties;
    const straat = p.street ? [p.street, p.housenumber].filter(Boolean).join(" ") : "";
    const titel = p.name || straat || p.city || "Onbekende plek";
    const details = [p.name ? straat : "", p.postcode, p.district, p.city]
        .filter((d) => d && d !== titel)
        .filter((d, i, lijst) => lijst.indexOf(d) === i)
        .join(", ");
    const icoon = p.housenumber ? "🏠" : p.osm_key === "highway" ? "🛣️" : p.osm_key === "place" ? "🏙️" : "📍";
    return {
        titel,
        details,
        icoon,
        latlng: L.latLng(f.geometry.coordinates[1], f.geometry.coordinates[0]),
    };
}

async function haalSuggesties(tekst, signal) {
    const sleutel = tekst.toLowerCase();
    if (suggestieCache.has(sleutel)) return suggestieCache.get(sleutel);
    const [[zuid, west], [noord, oost]] = AMSTERDAM_GRENZEN;
    const midden = mijnLocatie || map.getCenter();
    const url =
        `https://photon.komoot.io/api/?q=${encodeURIComponent(tekst)}&limit=8` +
        `&bbox=${west},${zuid},${oost},${noord}&lat=${midden.lat.toFixed(4)}&lon=${midden.lng.toFixed(4)}`;
    const antwoord = await fetch(url, { signal });
    if (!antwoord.ok) throw new Error(`Photon gaf ${antwoord.status}`);
    const { features = [] } = await antwoord.json();

    // Dubbele resultaten (bijv. een straat die uit meerdere stukken bestaat) maar één keer tonen
    const gezien = new Set();
    const resultaten = features
        .map(beschrijfPlek)
        .filter((r) => {
            const sleutel = `${r.titel}|${r.details}`;
            if (gezien.has(sleutel)) return false;
            gezien.add(sleutel);
            return true;
        })
        .slice(0, 6);
    if (suggestieCache.size > 100) suggestieCache.delete(suggestieCache.keys().next().value);
    suggestieCache.set(sleutel, resultaten);
    return resultaten;
}

function plaatsSuggesties() {
    if (!suggestieVeld) return;
    const vak = suggestieVeld.input.getBoundingClientRect();
    suggestieLijst.style.left = `${vak.left}px`;
    suggestieLijst.style.width = `${vak.width}px`;
    // Te weinig ruimte onder het veld (bijv. toetsenbord op de telefoon)? Dan erboven.
    if (innerHeight - vak.bottom < 220 && vak.top > innerHeight - vak.bottom) {
        suggestieLijst.style.top = "auto";
        suggestieLijst.style.bottom = `${innerHeight - vak.top + 6}px`;
    } else {
        suggestieLijst.style.top = `${vak.bottom + 6}px`;
        suggestieLijst.style.bottom = "auto";
    }
}

function markeerSuggestie(index) {
    if (!suggestieVeld) return;
    suggestieVeld.actief = index;
    [...suggestieLijst.children].forEach((li, i) => li.setAttribute("aria-selected", i === index));
    if (index >= 0) {
        suggestieLijst.children[index].scrollIntoView({ block: "nearest" });
        suggestieVeld.input.setAttribute("aria-activedescendant", `suggestie-${index}`);
    } else {
        suggestieVeld.input.removeAttribute("aria-activedescendant");
    }
}

function toonSuggesties(input, onKies, resultaten) {
    if (!resultaten.length) {
        sluitSuggesties();
        return;
    }
    suggestieVeld = { input, onKies, resultaten, actief: -1 };
    suggestieLijst.innerHTML = resultaten
        .map(
            (r, i) => `
            <li id="suggestie-${i}" role="option" aria-selected="false" data-index="${i}">
                <span class="suggestie-icoon" aria-hidden="true">${r.icoon}</span>
                <span class="suggestie-tekst">
                    <strong>${escapeHtml(r.titel)}</strong>
                    ${r.details ? `<small>${escapeHtml(r.details)}</small>` : ""}
                </span>
            </li>`
        )
        .join("");
    suggestieLijst.hidden = false;
    input.setAttribute("aria-expanded", "true");
    plaatsSuggesties();
}

function sluitSuggesties() {
    if (suggestieVeld) {
        suggestieVeld.input.setAttribute("aria-expanded", "false");
        suggestieVeld.input.removeAttribute("aria-activedescendant");
    }
    suggestieVeld = null;
    suggestieLijst.hidden = true;
    suggestieLijst.innerHTML = "";
}

function kiesSuggestie(index) {
    const veld = suggestieVeld;
    const gekozen = veld?.resultaten[index];
    if (!gekozen) return;
    veld.input.value = gekozen.titel;
    sluitSuggesties();
    veld.onKies(gekozen);
}

// Klikken in de lijst mag het veld niet laten "blurren" (dan zou de lijst al dicht zijn)
suggestieLijst.addEventListener("pointerdown", (e) => e.preventDefault());
suggestieLijst.addEventListener("click", (e) => {
    const li = e.target.closest("[data-index]");
    if (li) kiesSuggestie(Number(li.dataset.index));
});
addEventListener("resize", plaatsSuggesties);
document.addEventListener("scroll", plaatsSuggesties, true);

/** Geeft een invoerveld adressuggesties; onKies({ titel, details, latlng }) wordt aangeroepen bij een keuze. */
function koppelSuggesties(input, onKies) {
    let klok = null;
    let verzoek = null;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", "suggesties");
    input.setAttribute("autocomplete", "off");

    input.addEventListener("input", () => {
        clearTimeout(klok);
        verzoek?.abort();
        const tekst = input.value.trim();
        if (tekst.length < 3) {
            if (suggestieVeld?.input === input) sluitSuggesties();
            return;
        }
        klok = setTimeout(async () => {
            verzoek = new AbortController();
            try {
                const resultaten = await haalSuggesties(tekst, verzoek.signal);
                // Intussen verder getypt of weggeklikt? Dan niet meer tonen.
                if (document.activeElement !== input || input.value.trim() !== tekst) return;
                toonSuggesties(input, onKies, resultaten);
            } catch (err) {
                if (err.name !== "AbortError") console.warn("Suggesties ophalen mislukt", err);
            }
        }, 250);
    });

    input.addEventListener("keydown", (e) => {
        if (suggestieVeld?.input !== input) return;
        const aantal = suggestieVeld.resultaten.length;
        if (e.key === "ArrowDown") {
            e.preventDefault();
            markeerSuggestie((suggestieVeld.actief + 1) % aantal);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            markeerSuggestie(suggestieVeld.actief <= 0 ? aantal - 1 : suggestieVeld.actief - 1);
        } else if (e.key === "Enter" && suggestieVeld.actief >= 0) {
            e.preventDefault();
            kiesSuggestie(suggestieVeld.actief);
        } else if (e.key === "Escape") {
            e.preventDefault();
            sluitSuggesties();
        } else if (e.key === "Enter" || e.key === "Tab") {
            sluitSuggesties();
        }
    });

    input.addEventListener("blur", () => {
        clearTimeout(klok);
        if (suggestieVeld?.input === input) sluitSuggesties();
    });
}

koppelSuggesties(document.getElementById("zoek-input"), (r) =>
    toonGevondenPlek(r.latlng, r.titel, [r.titel, r.details].filter(Boolean).join(", "))
);

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
// Tussenstops in volgorde: { rij, input, punt: { latlng, label } | null, bezocht }
let routeStops = [];
const MAX_STOPS = 8;
const routeStopsEl = document.getElementById("route-stops");
const btnStopToevoegen = document.getElementById("btn-stop-toevoegen");
let routeOpties = []; // berekende routes, beste eerst
let actieveRoute = null;
let routeBezig = false;
let routeWachtrij = null; // aanvraag die binnenkwam terwijl er al gerekend werd

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
function verrijkRoute(r, stopLegs = new Map()) {
    const coords = r.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + afstandM(coords[i - 1], coords[i]));
    const schaal = cum.at(-1) > 0 ? r.distance / cum.at(-1) : 1;

    const stappen = [];
    let positie = 0;
    const stopPosities = []; // waar op de route (meters) je bij elke tussenstop bent
    r.legs.forEach((leg, li) => {
        // Na een tussenstop kan de route omkeren: dat melden we als aanwijzing
        if (li > 0) {
            const voor = r.legs[li - 1].steps.at(-1).maneuver.bearing_before;
            const na = leg.steps[0].maneuver.bearing_after;
            const verschil = Math.abs(((na - voor + 540) % 360) - 180);
            if (verschil > 150) {
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
            if (s.maneuver.type === "arrive" && stopLegs.has(li)) {
                stopPosities.push(positie);
                stappen.push({
                    tekst: `Tussenstop: ${stopLegs.get(li)}`,
                    pijl: "📍",
                    afstand: 0,
                    positie,
                    locatie: L.latLng(s.maneuver.location[1], s.maneuver.location[0]),
                });
            }
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

    return { afstand: r.distance, duur: r.duration, coords, cum, schaal, stappen, stopPosities, blokkades: [] };
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

/** Barrières die op of vlak naast de route liggen (alleen ter waarschuwing; de route wordt niet aangepast). */
function blokkadesOpRoute(route) {
    // Tijdens het volgen: wat achter je ligt (of precies waar je staat) is niet meer relevant
    const vanaf = volgen && mijnLocatie ? puntOpRoute(mijnLocatie, route).positie + 30 : -Infinity;
    return meldingen
        .map((m) => ({ melding: m, ...puntOpRoute(L.latLng(m.lat, m.lng), route) }))
        .filter((b) => b.afstand <= 25 && b.positie > vanaf)
        .sort((a, b) => a.positie - b.positie);
}

const ROUTE_TIMEOUT = 15_000;
const routeCache = new Map(); // url -> { tijd, data }

/** punten: [{ latlng, label }] (vertrek, tussenstops, bestemming). */
async function haalRoutes(punten, profiel) {
    const lijst = [];
    const stopLegs = new Map(); // index van het routedeel dat bij een tussenstop eindigt -> naam
    punten.forEach((p, i) => {
        if (i > 0 && i < punten.length - 1) stopLegs.set(lijst.length - 1, p.label);
        lijst.push(p.latlng);
    });
    const coords = lijst.map((p) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
    const url =
        `https://routing.openstreetmap.de/${profiel}/route/v1/driving/${coords}` +
        `?overview=full&geometries=geojson&steps=true&alternatives=${lijst.length === 2}`;
    let data = routeCache.get(url);
    if (!data || Date.now() - data.tijd > 10 * 60_000) {
        const antwoord = await fetchMetTimeout(url, ROUTE_TIMEOUT);
        if (!antwoord.ok) throw new Error(`Routeserver gaf ${antwoord.status}`);
        data = { tijd: Date.now(), json: await antwoord.json() };
        if (routeCache.size > 50) routeCache.delete(routeCache.keys().next().value);
        routeCache.set(url, data);
    }
    return data.json.code === "Ok" ? data.json.routes.map((r) => verrijkRoute(r, stopLegs)) : [];
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

/** Zoekt de coördinaten bij een tussenstop. Lege tussenstops slaan we over (null). */
async function bepaalStop(stop) {
    const tekst = stop.input.value.trim();
    if (stop.punt && stop.punt.label === tekst) return stop.punt.latlng;
    if (!tekst) return null;
    const plek = await zoekPlek(tekst);
    if (!plek) {
        stop.input.focus();
        throw gebruikersFout(`Geen plek gevonden voor tussenstop "${tekst}". Probeer een andere schrijfwijze.`);
    }
    stop.punt = { latlng: L.latLng(plek.lat, plek.lon), label: tekst };
    return stop.punt.latlng;
}

// --- Tussenstops ---

function renderStops() {
    routeStopsEl.replaceChildren(...routeStops.map((s) => s.rij));
    routeStops.forEach((s, i) => {
        s.rij.querySelector(".route-stip").textContent = s.bezocht ? "✓" : i + 1;
        s.rij.classList.toggle("bezocht", s.bezocht);
        s.input.setAttribute("aria-label", `Tussenstop ${i + 1}`);
        s.rij.querySelector(".route-stop-wis").setAttribute("aria-label", `Tussenstop ${i + 1} verwijderen`);
    });
    btnStopToevoegen.hidden = routeStops.length >= MAX_STOPS;
}

function voegStopToe(punt = null, { focus = true } = {}) {
    if (routeStops.length >= MAX_STOPS) {
        toast(`Je kunt maximaal ${MAX_STOPS} tussenstops toevoegen.`, "info");
        return null;
    }
    const rij = document.createElement("div");
    rij.className = "route-veld route-stop";
    rij.innerHTML = `
        <span class="route-stip route-stip-stop" aria-hidden="true"></span>
        <input placeholder="Tussenstop" autocomplete="off">
        <button type="button" class="route-stop-wis" title="Verwijderen">✕</button>`;
    const stop = { rij, input: rij.querySelector("input"), punt, bezocht: false };
    if (punt) stop.input.value = punt.label;
    rij.querySelector(".route-stop-wis").addEventListener("click", () => verwijderStop(stop));
    koppelSuggesties(stop.input, (r) => {
        stop.punt = { latlng: r.latlng, label: r.titel };
        naAdresGekozen();
    });
    routeStops.push(stop);
    renderStops();
    if (focus) stop.input.focus();
    return stop;
}

function verwijderStop(stop) {
    const telde = !!stop.punt && actieveRoute?.stops?.includes(stop);
    routeStops = routeStops.filter((s) => s !== stop);
    renderStops();
    werkOpslaanKnopBij();
    // Zat de stop in de berekende route? Dan meteen opnieuw berekenen.
    if (telde) planRoute({ stil: volgen, vanaf: volgen ? mijnLocatie : null });
}

function wisStops() {
    routeStops = [];
    renderStops();
}

btnStopToevoegen.addEventListener("click", () => voegStopToe());

// --- Adressuggesties in de routevelden ---

/** Na het kiezen van een adres: route meteen (opnieuw) berekenen zodra er een bestemming is. */
function naAdresGekozen() {
    werkOpslaanKnopBij();
    if (routeNaarInput.value.trim()) planRoute();
    else routeNaarInput.focus();
}

koppelSuggesties(routeVanInput, (r) => {
    routePunten.van = { latlng: r.latlng, label: r.titel };
    naAdresGekozen();
});
koppelSuggesties(routeNaarInput, (r) => {
    routePunten.naar = { latlng: r.latlng, label: r.titel };
    naAdresGekozen();
});

/** Punt op de kaart als tussenstop toevoegen (vanuit de kaart-popup). */
async function stopOpKaart(latlng) {
    if (routeStops.length >= MAX_STOPS) {
        toast(`Je kunt maximaal ${MAX_STOPS} tussenstops toevoegen.`, "info");
        return;
    }
    const naam = (await wegnaamBij(latlng)) || "Punt op de kaart";
    if (!voegStopToe({ latlng, label: naam }, { focus: false })) return;
    planRoute({ stil: true, vanaf: volgen ? mijnLocatie : null });
}

const gekozenVervoer = () => routeForm.querySelector('input[name="vervoer"]:checked').value;

async function planRoute({ vanaf = null, stil = false } = {}) {
    if (routeBezig) {
        routeWachtrij = { vanaf, stil };
        return;
    }
    routeBezig = true;
    routePlanKnop.disabled = true;
    const status = (tekst) => (routePlanKnop.textContent = tekst);
    status("Adressen zoeken…");

    try {
        // Leeg vertrekpunt = mijn locatie. Die bepalen we tegelijk met het opzoeken van de adressen.
        const vanLeeg = !vanaf && !routeVanInput.value.trim();
        const locatie = vanLeeg ? vraagLocatie() : null;
        locatie?.catch(() => {}); // fout wordt hieronder bij het wachten afgehandeld

        const vanAdres = vanaf || vanLeeg ? null : await bepaalPunt("van", routeVanInput);
        // Tijdens het volgen slaan we tussenstops over waar je al geweest bent
        const stops = [];
        for (const stop of routeStops) {
            if (vanaf && stop.bezocht) continue;
            if (await bepaalStop(stop)) stops.push(stop);
        }
        const naar = await bepaalPunt("naar", routeNaarInput);
        if (vanLeeg) status("Locatie bepalen…");
        const van = vanaf || vanAdres || (await locatie);
        status("Route berekenen…");
        const profiel = ROUTE_PROFIELEN[gekozenVervoer()];
        const punten = [
            { latlng: van, label: "Vertrek" },
            ...stops.map((s) => s.punt),
            { latlng: naar, label: "Bestemming" },
        ];

        const routes = await haalRoutes(punten, profiel);
        if (!routes.length) throw gebruikersFout("Er is geen route gevonden tussen deze punten.");
        routes.forEach((r) => {
            r.stops = stops;
            r.punten = punten;
            r.blokkades = blokkadesOpRoute(r);
        });

        routes.sort((a, b) => a.duur - b.duur);
        routeOpties = routes.slice(0, 3);
        kiesRoute(0, { zoom: !stil });
    } catch (err) {
        if (err.gebruikersTekst) {
            toast(err.gebruikersTekst, "info");
        } else if (err?.PERMISSION_DENIED === 1 || err.message === "geen geolocatie") {
            // Melding over de locatie is al getoond
            routeVanInput.focus();
        } else if (err.timeout) {
            toast("Het duurde te lang om de route op te halen: de server reageert niet of erg traag. Probeer het zo nog eens.", "fout");
        } else {
            console.error(err);
            toast("De route kon niet berekend worden. Controleer je internetverbinding en probeer opnieuw.", "fout");
        }
    } finally {
        routeBezig = false;
        routePlanKnop.disabled = false;
        routePlanKnop.textContent = "Route zoeken";
        if (routeWachtrij) {
            const volgende = routeWachtrij;
            routeWachtrij = null;
            planRoute(volgende);
        }
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
    if (routePuntSlepen) return;
    routeLaag.clearLayers();
    routeOpties.forEach((r, i) => {
        if (r === actieveRoute) return;
        L.polyline(r.coords, { color: "#8d9bbb", weight: 7, opacity: 0.75, bubblingMouseEvents: false })
            .bindTooltip(`${formatDuur(r.duur)} · ${formatAfstand(r.afstand)}`, { sticky: true })
            .on("click", () => kiesRoute(i, { zoom: false }))
            .addTo(routeLaag);
    });

    const r = actieveRoute;
    L.polyline(r.coords, { color: "#fff", weight: 12, interactive: false }).addTo(routeLaag);
    L.polyline(r.coords, { color: "#0342df", weight: 7, interactive: false }).addTo(routeLaag);

    const punten = r.punten || [{ latlng: L.latLng(r.coords[0]) }, { latlng: L.latLng(r.coords.at(-1)) }];

    // Vertrek: bolletje met het gekozen vervoer. Tijdens het volgen is dat je eigen locatie: niet versleepbaar.
    const startHtml = `<div class="route-doel route-start">${(VERVOER[gekozenVervoer()] || VERVOER.auto).icoon}</div>`;
    if (volgen) {
        L.marker(r.coords[0], {
            icon: L.divIcon({ className: "", html: startHtml, iconSize: [36, 36], iconAnchor: [18, 18] }),
            interactive: false,
            keyboard: false,
        }).addTo(routeLaag);
    } else {
        routePuntMarker(punten[0].latlng, startHtml, 36, "Vertrek", (latlng, label) => {
            routePunten.van = { latlng, label };
            routeVanInput.value = label;
        });
    }

    routePuntMarker(punten.at(-1).latlng, '<div class="route-doel">🏁</div>', 36, "Bestemming", (latlng, label) => {
        routePunten.naar = { latlng, label };
        routeNaarInput.value = label;
    });

    (r.stops || []).forEach((stop) => {
        const nr = routeStops.indexOf(stop) + 1;
        if (!nr) return;
        const html = `<div class="route-stop-pin${stop.bezocht ? " bezocht" : ""}">${stop.bezocht ? "✓" : nr}</div>`;
        routePuntMarker(stop.punt.latlng, html, 28, `Tussenstop ${nr}: ${stop.punt.label}`, (latlng, label) => {
            stop.punt = { latlng, label };
            stop.input.value = label;
            stop.bezocht = false;
            renderStops();
        });
    });
}

let routePuntSlepen = false; // zolang je een punt versleept, tekenen we de route niet opnieuw

/** Marker voor een routepunt die je kunt verslepen; bijwerken(latlng, label) zet het nieuwe punt in het paneel. */
function routePuntMarker(latlng, html, grootte, naam, bijwerken) {
    const marker = L.marker(latlng, {
        icon: L.divIcon({ className: "route-punt-sleep", html, iconSize: [grootte, grootte], iconAnchor: [grootte / 2, grootte / 2] }),
        draggable: true,
        autoPan: true,
        keyboard: false,
        zIndexOffset: 500,
    })
        .bindTooltip(`${escapeHtml(naam)}<br><small>Sleep om te verplaatsen</small>`, { direction: "top", offset: [0, -grootte / 2] })
        .addTo(routeLaag);

    marker.on("dragstart", () => {
        routePuntSlepen = true;
        marker.closeTooltip();
    });
    marker.on("dragend", async () => {
        routePuntSlepen = false;
        const nieuw = marker.getLatLng();
        marker.getElement()?.classList.add("bezig");
        const label = (await wegnaamBij(nieuw)) || "Punt op de kaart";
        bijwerken(nieuw, label);
        werkOpslaanKnopBij();
        planRoute({ stil: true, vanaf: volgen ? mijnLocatie : null });
    });
    return marker;
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
    werkOpslaanKnopBij();
}

function toonRouteWaarschuwing() {
    const r = actieveRoute;
    let html = "";

    if (r.blokkades.length) {
        const n = r.blokkades.length;
        const items = r.blokkades
            .map((b) => {
                const m = b.melding;
                return `<li><button type="button" data-blokkade="${m.id}">
                    <span>${impactVan(m).emoji}</span>
                    <span><b>${escapeHtml(m.wat)}</b><small>Barrière ${escapeHtml(m.nr ?? "?")} · impact ${m.impact}/5</small></span>
                </button></li>`;
            })
            .join("");
        html += `
            <div class="route-melding route-melding-letop">
                <strong>⚠️ ${n} ${n === 1 ? "barrière" : "barrières"} op je route</strong>
                <ul>${items}</ul>
            </div>`;
    } else {
        html += `<div class="route-melding route-melding-ok"><strong>✅ Geen barrières op je route</strong></div>`;
    }

    if (routeOpties.length > 1 && !volgen) {
        html += `<p class="route-noot">Tik op een grijze lijn op de kaart voor een andere route.</p>`;
    }
    routeWaarschuwing.innerHTML = html;
}

// Barrières veranderd: opnieuw bepalen welke op de route liggen
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
    navigator.permissions
        ?.query({ name: "geolocation" })
        .then((p) => p.state === "granted" && navigator.geolocation && startLocatie(false))
        .catch(() => {});
    routePaneel.hidden = false;
    meldPaneel.hidden = true;
}

function sluitRoutePaneel() {
    stopVolgen();
    wisRoute();
    routeForm.reset();
    wisStops();
    routePunten.van = routePunten.naar = null;
    routePaneel.hidden = true;
    meldPaneel.hidden = false;
}

/** Plan een route naar een punt (vanuit popups op de kaart). */
function routeNaar(latlng, label) {
    openRoutePaneel();
    routePunten.naar = { latlng, label };
    routeNaarInput.value = label;
    planRoute();
}

// "Route plannen" in het menu links; het routepaneel vervangt dan het menu (sluiten met ✕)
btnRoute.addEventListener("click", () => {
    openRoutePaneel();
    routeNaarInput.focus();
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
    routeStops.reverse();
    renderStops();
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
    routeStops.forEach((s) => (s.bezocht = false));
    renderStops();
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

    // Bij een tussenstop aangekomen?
    (r.stops || []).forEach((stop, i) => {
        if (stop.bezocht || r.stopPosities[i] === undefined) return;
        const dichtbij = mijnLocatie.distanceTo(stop.punt.latlng) < 40;
        if (dichtbij || (plek.positie > r.stopPosities[i] - 25 && plek.afstand < 40)) {
            stop.bezocht = true;
            renderStops();
            tekenRoutes();
            toast(`Tussenstop bereikt: ${stop.punt.label} 📍`, "succes", 4000);
            spreek(`Je bent bij tussenstop ${stop.punt.label}.`);
        }
    });

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

    // Waarschuwen voor barrières die eraan komen
    for (const b of r.blokkades) {
        const vooruit = b.positie - plek.positie;
        if (vooruit > -20 && vooruit < 600 && !gewaarschuwd.has(b.melding.id)) {
            gewaarschuwd.add(b.melding.id);
            const waar = vooruit < 50 ? "Hier" : `Over ${formatAfstand(vooruit)}`;
            toast(`${waar}: barrière ${b.melding.nr} – ${b.melding.wat} (impact ${b.melding.impact}/5)`, "fout", 8000);
            spreek(`Let op! ${vooruit < 50 ? "Hier" : `Over ${spreekAfstand(vooruit)}`} is een barrière: ${b.melding.wat}.`);
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

// ---------- Opgeslagen routes ----------
// We bewaren alleen de punten en het vervoer, zodat bij openen de route (en blokkades) opnieuw berekend worden.
// Een opgeslagen route ziet er zo uit: { id, van: { lat, lng, label } | null (= mijn locatie), stops: [{ lat, lng, label }], naar: { lat, lng, label }, vervoer, opgeslagen }

const VERVOER = {
    auto: { label: "Auto", icoon: "🚗" },
    fiets: { label: "Fiets", icoon: "🚲" },
    lopen: { label: "Lopen", icoon: "🚶" },
};
const btnRouteOpslaan = document.getElementById("btn-route-opslaan");
const opgeslagenLijst = document.getElementById("lijst");

function laadRoutes() {
    try {
        return JSON.parse(localStorage.getItem(ROUTES_SLEUTEL)) || [];
    } catch {
        return [];
    }
}

function bewaarRoutes() {
    try {
        localStorage.setItem(ROUTES_SLEUTEL, JSON.stringify(opgeslagenRoutes));
        return true;
    } catch (err) {
        console.warn("Opslaan mislukt", err);
        return false;
    }
}

let opgeslagenRoutes = laadRoutes();

const puntLabel = (p) => (p ? p.label : "Mijn locatie");
const zelfdePunt = (a, b) => (!a && !b) || (a && b && L.latLng(a).distanceTo(b) < 10);

/** De route zoals die nu in het paneel staat, of null als de velden niet meer bij de berekende route passen. */
function huidigeRouteGegevens() {
    if (!actieveRoute) return null;
    const vanTekst = routeVanInput.value.trim();
    const naarTekst = routeNaarInput.value.trim();
    const { van, naar } = routePunten;
    if (!naar || naar.label !== naarTekst) return null;
    if (vanTekst && (!van || van.label !== vanTekst)) return null;
    const gevuld = routeStops.filter((st) => st.input.value.trim());
    if (gevuld.some((st) => !st.punt || st.punt.label !== st.input.value.trim())) return null;
    const punt = (p) => ({ lat: p.latlng.lat, lng: p.latlng.lng, label: p.label });
    return {
        van: vanTekst ? punt(van) : null,
        stops: gevuld.map((st) => punt(st.punt)),
        naar: punt(naar),
        vervoer: gekozenVervoer(),
    };
}

function zoekOpgeslagen(g) {
    return opgeslagenRoutes.find(
        (r) =>
            r.vervoer === g.vervoer &&
            zelfdePunt(r.van, g.van) &&
            zelfdePunt(r.naar, g.naar) &&
            (r.stops || []).length === g.stops.length &&
            g.stops.every((st, i) => zelfdePunt(r.stops[i], st))
    );
}

function werkOpslaanKnopBij() {
    const g = huidigeRouteGegevens();
    const al = g && zoekOpgeslagen(g);
    btnRouteOpslaan.textContent = al ? "★ Opgeslagen" : "☆ Opslaan";
    btnRouteOpslaan.title = al ? `Opgeslagen als "${routeNaam(al)}" — tik om niet meer op te slaan` : "Route opslaan";
    btnRouteOpslaan.classList.toggle("opgeslagen", !!al);
}

/** Naam van een opgeslagen route; oudere routes zonder naam heten naar hun bestemming. */
const routeNaam = (r) => r.naam || `Naar ${r.naar.label}`;

function renderOpgeslagen() {
    document.getElementById("aantal").textContent = opgeslagenRoutes.length;
    document.getElementById("leeg").hidden = opgeslagenRoutes.length > 0;

    opgeslagenLijst.innerHTML = [...opgeslagenRoutes]
        .sort((a, b) => b.opgeslagen - a.opgeslagen)
        .map((r) => {
            const v = VERVOER[r.vervoer] || VERVOER.auto;
            return `
            <li class="route-item">
                <button class="lijst-item" type="button" data-route="${r.id}" style="--kleur:#0342df">
                    <span class="lijst-icoon">${v.icoon}</span>
                    <span class="lijst-tekst">
                        <strong>${escapeHtml(routeNaam(r))}</strong>
                        <small>${escapeHtml(puntLabel(r.van))} → ${escapeHtml(r.naar.label)}</small>
                        ${r.stops?.length ? `<small>via ${r.stops.map((st) => escapeHtml(st.label)).join(", ")}</small>` : ""}
                        <span class="lijst-tags">
                            <span class="tag">${v.label}</span>
                            <span class="tag">Opgeslagen ${formatDatum(r.opgeslagen)}</span>
                        </span>
                    </span>
                </button>
                <span class="route-item-knoppen">
                    <button class="route-item-knop" type="button" data-hernoem-route="${r.id}" aria-label="Route ${escapeHtml(routeNaam(r))} hernoemen" title="Naam wijzigen">✏️</button>
                    <button class="route-item-knop" type="button" data-wis-route="${r.id}" aria-label="Route ${escapeHtml(routeNaam(r))} verwijderen" title="Verwijderen">🗑️</button>
                </span>
            </li>`;
        })
        .join("");
}

btnRouteOpslaan.addEventListener("click", async () => {
    const g = huidigeRouteGegevens();
    if (!g) {
        toast("Zoek de route eerst opnieuw, de velden zijn aangepast.", "info");
        return;
    }
    const al = zoekOpgeslagen(g);
    if (al) {
        opgeslagenRoutes = opgeslagenRoutes.filter((r) => r !== al);
        bewaarRoutes();
        toast("Route niet meer opgeslagen", "info", 3000);
    } else {
        const standaard = `Naar ${g.naar.label}`;
        const naam = await vraagTekst({
            titel: "Route opslaan",
            tekst: "Geef je route een naam, zodat je hem makkelijk terugvindt.",
            waarde: standaard,
            placeholder: "Bijv. Naar mijn werk",
            okTekst: "Opslaan",
            icoon: "⭐",
        });
        if (naam === null) return;
        opgeslagenRoutes = [
            ...opgeslagenRoutes,
            {
                id: crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
                naam: naam || standaard,
                ...g,
                opgeslagen: Date.now(),
            },
        ];
        if (!bewaarRoutes()) {
            opgeslagenRoutes = opgeslagenRoutes.slice(0, -1);
            toast("Opslaan mislukt: de opslag in deze browser is vol.", "fout", 8000);
            return;
        }
        toast(`"${naam || standaard}" opgeslagen ★`, "succes", 3000);
    }
    renderOpgeslagen();
    werkOpslaanKnopBij();
});

/** Opent een opgeslagen route in het routepaneel en berekent hem opnieuw. */
function openOpgeslagenRoute(r) {
    stopVolgen();
    wisRoute();
    openRoutePaneel();
    const punt = (p) => p && { latlng: L.latLng(p.lat, p.lng), label: p.label };
    routePunten.van = punt(r.van);
    routePunten.naar = punt(r.naar);
    routeVanInput.value = r.van ? r.van.label : "";
    routeNaarInput.value = r.naar.label;
    wisStops();
    (r.stops || []).forEach((st) => voegStopToe(punt(st), { focus: false }));
    const radio = routeForm.querySelector(`input[name="vervoer"][value="${r.vervoer}"]`);
    if (radio) radio.checked = true;
    planRoute();
}

opgeslagenLijst.addEventListener("click", async (e) => {
    const hernoem = e.target.closest("[data-hernoem-route]");
    if (hernoem) {
        const r = opgeslagenRoutes.find((x) => x.id === hernoem.dataset.hernoemRoute);
        if (!r) return;
        const naam = await vraagTekst({
            titel: "Naam wijzigen",
            waarde: routeNaam(r),
            placeholder: "Bijv. Naar mijn werk",
            okTekst: "Opslaan",
        });
        if (!naam || naam === routeNaam(r)) return;
        const vorige = r.naam;
        r.naam = naam;
        if (!bewaarRoutes()) {
            r.naam = vorige;
            toast("Opslaan mislukt: de opslag in deze browser is vol.", "fout", 8000);
            return;
        }
        renderOpgeslagen();
        werkOpslaanKnopBij();
        return;
    }
    const wis = e.target.closest("[data-wis-route]");
    if (wis) {
        const r = opgeslagenRoutes.find((x) => x.id === wis.dataset.wisRoute);
        if (!r) return;
        bevestig({
            titel: "Route verwijderen?",
            tekst: `"${routeNaam(r)}" wordt uit je opgeslagen routes gehaald.`,
            okTekst: "Ja, verwijderen",
            icoon: "🗑️",
            gevaar: true,
        }).then((ja) => {
            if (!ja) return;
            opgeslagenRoutes = opgeslagenRoutes.filter((x) => x.id !== r.id);
            bewaarRoutes();
            renderOpgeslagen();
            toast("Route verwijderd", "succes", 3000);
        });
        return;
    }
    const knop = e.target.closest("[data-route]");
    const r = knop && opgeslagenRoutes.find((x) => x.id === knop.dataset.route);
    if (r) openOpgeslagenRoute(r);
});

// Opslaan-knop bijwerken als er een nieuwe route getoond wordt of de velden veranderen
routeForm.addEventListener("input", werkOpslaanKnopBij);
routeForm.addEventListener("change", werkOpslaanKnopBij);

renderOpgeslagen();

// ---------- Hier melden (tijdens het volgen van een route) ----------
// Opent het gewone meldformulier op de plek waar je was toen je op de knop drukte.

/** Straatnaam en plaats bij een punt (OpenStreetMap). */
async function wegnaamBij(punt) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=json&zoom=17&lat=${punt.lat}&lon=${punt.lng}`;
        const antwoord = await fetchMetTimeout(url, 5_000, { headers: { "Accept-Language": "nl" } });
        const { address: a = {} } = await antwoord.json();
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
}

// ---------- Start ----------

render();
