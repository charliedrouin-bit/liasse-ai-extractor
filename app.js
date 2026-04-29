import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================
//  LiasseAI v3 — PDF.js Pre-Processing + Gemini 2.0 Flash
// ============================================

// PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

lucide.createIcons();

const state = { selectedFile: null, extractedData: null, pdfInfo: null };

const el = {
    apiKey: document.getElementById('api-key'),
    toggleKey: document.getElementById('toggle-key'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    fileInfo: document.getElementById('file-info'),
    fileName: document.getElementById('file-name'),
    fileMeta: document.getElementById('file-meta'),
    removeFile: document.getElementById('remove-file'),
    extractBtn: document.getElementById('extract-btn'),
    pipelineArea: document.getElementById('pipeline-area'),
    pipelineTitle: document.getElementById('pipeline-title'),
    pipelineSteps: document.getElementById('pipeline-steps'),
    pipelineDetail: document.getElementById('pipeline-detail'),
    errorArea: document.getElementById('error-area'),
    errorMessage: document.getElementById('error-message'),
    retryBtn: document.getElementById('retry-btn'),
    previewArea: document.getElementById('preview-area'),
    previewMeta: document.getElementById('preview-meta'),
    downloadBtn: document.getElementById('download-btn'),
    newExtractBtn: document.getElementById('new-extract-btn'),
    tableActif: document.querySelector('#table-actif tbody'),
    tablePassif: document.querySelector('#table-passif tbody'),
    tableResultat: document.querySelector('#table-resultat tbody'),
    kpiGrid: document.getElementById('kpi-grid'),
    balanceCheck: document.getElementById('balance-check'),
};

// ============================================
//  1. API Key
// ============================================
const savedKey = localStorage.getItem('gemini_api_key');
if (savedKey) el.apiKey.value = savedKey;

el.apiKey.addEventListener('input', () => {
    localStorage.setItem('gemini_api_key', el.apiKey.value.trim());
    validateForm();
});

el.toggleKey.addEventListener('click', () => {
    const show = el.apiKey.type === 'password';
    el.apiKey.type = show ? 'text' : 'password';
    el.toggleKey.innerHTML = `<i data-lucide="${show ? 'eye-off' : 'eye'}"></i>`;
    lucide.createIcons();
});

// ============================================
//  2. File Handling
// ============================================
el.dropZone.addEventListener('click', (e) => {
    if (e.target.closest('#remove-file')) return;
    el.fileInput.click();
});
el.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); el.dropZone.classList.add('dragover'); });
el.dropZone.addEventListener('dragleave', () => el.dropZone.classList.remove('dragover'));
el.dropZone.addEventListener('drop', (e) => {
    e.preventDefault(); el.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
el.fileInput.addEventListener('change', () => { if (el.fileInput.files[0]) handleFile(el.fileInput.files[0]); });
el.removeFile.addEventListener('click', (e) => { e.stopPropagation(); resetFile(); });

async function handleFile(file) {
    if (file.type !== 'application/pdf') return showError("Format invalide. Sélectionnez un fichier PDF.");
    state.selectedFile = file;
    el.fileName.textContent = file.name;
    el.fileMeta.textContent = `${(file.size / 1024 / 1024).toFixed(2)} Mo`;
    el.dropZone.classList.add('has-file');

    // Quick PDF.js scan for page count
    try {
        const buf = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
        state.pdfInfo = { pageCount: pdf.numPages };
        el.fileMeta.textContent += ` · ${pdf.numPages} pages`;
    } catch { /* non-blocking */ }

    validateForm();
}

function resetFile() {
    state.selectedFile = null; state.pdfInfo = null;
    el.fileInput.value = ''; el.dropZone.classList.remove('has-file');
    validateForm();
}

function validateForm() {
    el.extractBtn.disabled = !(el.apiKey.value.trim().length > 10 && state.selectedFile);
}

// ============================================
//  3. Pipeline UI
// ============================================
const STEPS = [
    { id: 'pdf-load',  label: 'Chargement et validation du PDF' },
    { id: 'pdf-text',  label: 'Extraction du texte (PDF.js)' },
    { id: 'pdf-class', label: 'Classification des pages financières' },
    { id: 'ai-send',   label: 'Envoi à Gemini 2.0 Flash' },
    { id: 'ai-parse',  label: 'Parsing et validation du JSON' },
    { id: 'render',    label: 'Construction de la prévisualisation' },
];

function showPipeline() {
    el.pipelineArea.classList.remove('hidden');
    el.errorArea.classList.add('hidden');
    el.previewArea.classList.add('hidden');
    el.pipelineSteps.innerHTML = STEPS.map(s =>
        `<div class="pipe-step waiting" id="step-${s.id}"><i data-lucide="circle"></i><span class="step-label">${s.label}</span><span class="step-duration"></span></div>`
    ).join('');
    el.pipelineDetail.textContent = '';
    el.pipelineTitle.textContent = 'Pipeline de traitement';
    lucide.createIcons();
}

function setStep(id, status, duration = null) {
    const div = document.getElementById(`step-${id}`);
    if (!div) return;
    const icons = { waiting: 'circle', active: 'loader', done: 'check-circle', error: 'x-circle' };
    div.className = `pipe-step ${status}`;
    div.querySelector('i, svg').outerHTML = `<i data-lucide="${icons[status]}"></i>`;
    if (duration !== null) div.querySelector('.step-duration').textContent = `${duration}ms`;
    lucide.createIcons();
}

function logDetail(msg) {
    el.pipelineDetail.textContent += msg + '\n';
    el.pipelineDetail.scrollTop = el.pipelineDetail.scrollHeight;
}

// ============================================
//  4. PDF Pre-Processing with PDF.js
// ============================================
async function preprocessPDF(file) {
    const t0 = performance.now();
    setStep('pdf-load', 'active');

    const arrayBuf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    const pageCount = pdf.numPages;
    logDetail(`PDF chargé : ${pageCount} pages, ${(file.size/1024).toFixed(0)} Ko`);
    setStep('pdf-load', 'done', Math.round(performance.now() - t0));

    // Extract text from each page
    setStep('pdf-text', 'active');
    const t1 = performance.now();
    const pageTexts = [];
    for (let i = 1; i <= pageCount; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map(item => item.str).join(' ');
        pageTexts.push({ page: i, text, charCount: text.length });
    }
    const totalChars = pageTexts.reduce((s, p) => s + p.charCount, 0);
    logDetail(`Texte extrait : ${totalChars} caractères sur ${pageCount} pages`);
    setStep('pdf-text', 'done', Math.round(performance.now() - t1));

    // Classify pages
    setStep('pdf-class', 'active');
    const t2 = performance.now();
    const keywords = {
        actif: /actif|immobilis|circulant|tr[ée]sorerie|stocks/i,
        passif: /passif|capitaux propres|dettes|provisions|emprunt/i,
        resultat: /r[ée]sultat|chiffre.?d.?affaires|produits?.*exploit|charges?.*exploit|b[ée]n[ée]fice/i,
        fiscal: /liasse|fiscal|cerfa|bilan|2050|2051|2052|2053/i,
    };

    const classified = pageTexts.map(p => {
        const tags = [];
        for (const [tag, re] of Object.entries(keywords)) {
            if (re.test(p.text)) tags.push(tag);
        }
        return { ...p, tags, isFinancial: tags.length > 0 };
    });

    const financialPages = classified.filter(p => p.isFinancial);
    logDetail(`Pages financières identifiées : ${financialPages.length}/${pageCount}`);
    financialPages.forEach(p => logDetail(`  → Page ${p.page}: [${p.tags.join(', ')}]`));
    setStep('pdf-class', 'done', Math.round(performance.now() - t2));

    // Build context text (concatenate financial pages, fallback to all if none found)
    const contextPages = financialPages.length > 0 ? financialPages : classified;
    const contextText = contextPages.map(p => `--- PAGE ${p.page} ---\n${p.text}`).join('\n\n');

    return { pageCount, contextText, classified, totalChars };
}

// ============================================
//  5. Convert file to base64 for Gemini
// ============================================
async function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve({ inlineData: { data: reader.result.split(',')[1], mimeType: 'application/pdf' } });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ============================================
//  6. Gemini Prompt (with pre-extracted context)
// ============================================
function buildPrompt(contextText) {
    return `Tu es un expert-comptable senior spécialisé en liasses fiscales françaises (Cerfa 2050-2059) et marocaines (CPC).

MISSION : Extrais TOUTES les données financières de ce document PDF.

CONTEXTE PRÉ-EXTRAIT (texte OCR des pages financières — utilise-le pour vérifier tes lectures) :
"""
${contextText.substring(0, 15000)}
"""

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec un objet JSON. Zéro texte avant ou après.
2. Si une valeur est absente/illisible : utilise null.
3. Supprime les codes comptables (AA, AB...) des libellés. Garde le libellé clair.
4. Montants en unités (pas de milliers, pas de symboles monétaires).
5. N = exercice le plus récent. N-1 = exercice précédent.
6. IMPORTANT : Vérifie que Total Actif ≈ Total Passif. Signale tout écart.

STRUCTURE JSON :
{
  "meta": {
    "entreprise": "string|null",
    "exercice_N": "string|null",
    "exercice_N1": "string|null",
    "devise": "EUR|MAD|null",
    "format": "FR_CERFA|MA_CPC|AUTRE"
  },
  "bilan_actif": [
    {"rubrique":"string","brut":number|null,"amort":number|null,"net_N":number|null,"net_N1":number|null}
  ],
  "bilan_passif": [
    {"rubrique":"string","net_N":number|null,"net_N1":number|null}
  ],
  "compte_resultat": [
    {"rubrique":"string","montant_N":number|null,"montant_N1":number|null}
  ],
  "kpis": {
    "chiffre_affaires_N":null,"chiffre_affaires_N1":null,
    "resultat_exploitation_N":null,"resultat_net_N":null,
    "total_actif_N":null,"total_passif_N":null,
    "capitaux_propres_N":null,"ebitda_estime_N":null
  }
}`;
}

// ============================================
//  7. Main Extraction Pipeline
// ============================================
el.extractBtn.addEventListener('click', runExtraction);
el.retryBtn.addEventListener('click', () => { el.errorArea.classList.add('hidden'); runExtraction(); });

async function runExtraction() {
    const apiKey = el.apiKey.value.trim();
    el.extractBtn.disabled = true;
    showPipeline();

    try {
        // Phase 1: PDF pre-processing
        const preprocess = await preprocessPDF(state.selectedFile);

        // Phase 2: Send to Gemini
        setStep('ai-send', 'active');
        const t3 = performance.now();
        logDetail('Connexion à Gemini 2.0 Flash...');

        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: { responseMimeType: "application/json", temperature: 0.05 }
        });

        const filePart = await fileToBase64(state.selectedFile);
        const prompt = buildPrompt(preprocess.contextText);

        // Call with timeout (120s)
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000);
        let result;
        try {
            result = await model.generateContent([prompt, filePart], { signal: controller.signal });
        } finally { clearTimeout(timeout); }

        logDetail(`Réponse reçue en ${Math.round(performance.now() - t3)}ms`);
        setStep('ai-send', 'done', Math.round(performance.now() - t3));

        // Phase 3: Parse JSON
        setStep('ai-parse', 'active');
        const t4 = performance.now();
        let text = result.response.text();
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();

        let data;
        try {
            data = JSON.parse(text);
        } catch (parseErr) {
            // Retry: try to extract JSON object from the response
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                data = JSON.parse(jsonMatch[0]);
                logDetail('⚠ JSON corrigé automatiquement (extraction du bloc)');
            } else {
                throw new Error("L'IA n'a pas renvoyé un JSON valide. Réessayez.");
            }
        }

        // Validate structure
        if (!data.bilan_actif && !data.bilan_passif && !data.compte_resultat) {
            throw new Error("Le JSON reçu ne contient aucune donnée financière exploitable.");
        }
        data.bilan_actif = data.bilan_actif || [];
        data.bilan_passif = data.bilan_passif || [];
        data.compte_resultat = data.compte_resultat || [];
        data.kpis = data.kpis || {};
        data.meta = data.meta || {};

        logDetail(`Données validées : ${data.bilan_actif.length} postes actif, ${data.bilan_passif.length} postes passif, ${data.compte_resultat.length} postes CdR`);
        state.extractedData = data;
        setStep('ai-parse', 'done', Math.round(performance.now() - t4));

        // Phase 4: Render preview
        setStep('render', 'active');
        const t5 = performance.now();
        renderPreview(data);
        setStep('render', 'done', Math.round(performance.now() - t5));

        // Done
        el.pipelineTitle.textContent = '✓ Extraction terminée';
        setTimeout(() => {
            el.pipelineArea.classList.add('hidden');
            el.previewArea.classList.remove('hidden');
            lucide.createIcons();
        }, 600);

    } catch (error) {
        console.error('[LiasseAI]', error);
        let msg = error.message || "Erreur inconnue";
        if (error.name === 'AbortError') msg = "Timeout : l'analyse a pris plus de 2 minutes. Essayez avec un PDF plus court.";
        else if (msg.includes('404')) msg += "\n\nConseil : Le modèle gemini-2.0-flash n'est pas disponible avec votre clé. Vérifiez sur aistudio.google.com.";
        else if (msg.includes('API_KEY') || msg.includes('API key')) msg += "\n\nConseil : Clé API invalide ou expirée.";
        else if (msg.includes('quota') || msg.includes('429')) msg += "\n\nConseil : Quota dépassé. Attendez quelques minutes.";
        showError(msg);
    }
}

// ============================================
//  8. Error Display
// ============================================
function showError(msg) {
    el.pipelineArea.classList.add('hidden');
    el.errorArea.classList.remove('hidden');
    el.errorMessage.textContent = msg;
    el.extractBtn.disabled = false;
    lucide.createIcons();
}

// ============================================
//  9. Preview Rendering
// ============================================
function fmt(v) { return v == null ? '—' : Number(v).toLocaleString('fr-FR'); }
function varPct(n, n1) {
    if (n == null || n1 == null || n1 === 0) return { text: '—', cls: 'var-neutral' };
    const pct = ((n - n1) / Math.abs(n1) * 100).toFixed(1);
    return { text: `${pct > 0 ? '+' : ''}${pct}%`, cls: n >= n1 ? 'var-positive' : 'var-negative' };
}

function buildRows(tbody, rows, keyN, keyN1, showBrut = false) {
    tbody.innerHTML = '';
    if (!rows?.length) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--text-dimmed);padding:1.5rem;">Aucune donnée</td></tr>';
        return;
    }
    rows.forEach(row => {
        const n = row[keyN], n1 = row[keyN1];
        const v = varPct(n, n1);
        const isTotal = /total/i.test(row.rubrique || '');
        const tr = document.createElement('tr');
        if (isTotal) tr.classList.add('row-total');
        let cells = `<td contenteditable="true">${row.rubrique || ''}</td>`;
        if (showBrut) {
            cells += `<td contenteditable="true">${fmt(row.brut)}</td>`;
            cells += `<td contenteditable="true">${fmt(row.amort)}</td>`;
        }
        cells += `<td contenteditable="true">${fmt(n)}</td>`;
        cells += `<td contenteditable="true">${fmt(n1)}</td>`;
        cells += `<td class="${v.cls}">${v.text}</td>`;
        tr.innerHTML = cells;
        tbody.appendChild(tr);
    });
}

function renderPreview(data) {
    buildRows(el.tableActif, data.bilan_actif, 'net_N', 'net_N1', true);
    buildRows(el.tablePassif, data.bilan_passif, 'net_N', 'net_N1');
    buildRows(el.tableResultat, data.compte_resultat, 'montant_N', 'montant_N1');
    renderKPIs(data.kpis, data.meta);
    checkBalance(data.kpis);

    // Meta display
    const m = data.meta;
    el.previewMeta.textContent = [m.entreprise, m.exercice_N, m.devise, m.format].filter(Boolean).join(' · ');
}

function renderKPIs(kpis, meta) {
    el.kpiGrid.innerHTML = '';
    if (!kpis) return;
    const defs = [
        { key: 'chiffre_affaires_N', label: "Chiffre d'Affaires" },
        { key: 'resultat_exploitation_N', label: "Résultat d'Exploitation" },
        { key: 'resultat_net_N', label: "Résultat Net" },
        { key: 'ebitda_estime_N', label: "EBITDA (estimé)" },
        { key: 'total_actif_N', label: "Total Actif" },
        { key: 'capitaux_propres_N', label: "Capitaux Propres" },
    ];
    defs.forEach(d => {
        const val = kpis[d.key];
        const n1 = kpis[d.key.replace('_N', '_N1')] || null;
        const v = varPct(val, n1);
        const card = document.createElement('div');
        card.className = 'kpi-card';
        card.innerHTML = `<p class="kpi-label">${d.label}</p><p class="kpi-value">${fmt(val)}</p>${v.text !== '—' ? `<p class="kpi-change ${v.cls}">${v.text} vs N-1</p>` : ''}`;
        el.kpiGrid.appendChild(card);
    });
}

function checkBalance(kpis) {
    if (!kpis) return;
    const a = kpis.total_actif_N, p = kpis.total_passif_N;
    if (a == null || p == null) { el.balanceCheck.innerHTML = ''; return; }
    const ok = Math.abs(a - p) < 2;
    el.balanceCheck.className = `balance-check ${ok ? 'balanced' : 'unbalanced'}`;
    el.balanceCheck.innerHTML = ok
        ? `<i data-lucide="check-circle"></i> Bilan équilibré — Actif = Passif = ${fmt(a)}`
        : `<i data-lucide="alert-triangle"></i> Écart : Actif (${fmt(a)}) ≠ Passif (${fmt(p)})`;
    lucide.createIcons();
}

// ============================================
//  10. Tab Navigation
// ============================================
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
    });
});

// ============================================
//  11. Excel Generation
// ============================================
el.downloadBtn.addEventListener('click', () => {
    if (!state.extractedData) return;
    const data = state.extractedData;
    const wb = XLSX.utils.book_new();

    function addSheet(name, rows, headers, keys) {
        if (!rows?.length) return;
        const wsData = [headers, ...rows.map(r => keys.map(k => r[k] ?? null))];
        const ws = XLSX.utils.aoa_to_sheet(wsData);
        ws['!cols'] = headers.map((_, i) => ({ wch: i === 0 ? 45 : 16 }));

        // Add SUM formula row
        const lr = rows.length + 1;
        const sumRow = headers.map((_, i) => {
            if (i === 0) return 'TOTAL (calculé)';
            const col = XLSX.utils.encode_col(i);
            return { f: `SUM(${col}2:${col}${lr})` };
        });
        XLSX.utils.sheet_add_aoa(ws, [sumRow], { origin: `A${lr + 2}` });
        XLSX.utils.book_append_sheet(wb, ws, name);
    }

    addSheet('Bilan Actif', data.bilan_actif,
        ['Rubrique', 'Brut', 'Amort.', 'Net N', 'Net N-1'],
        ['rubrique', 'brut', 'amort', 'net_N', 'net_N1']);

    addSheet('Bilan Passif', data.bilan_passif,
        ['Rubrique', 'Net N', 'Net N-1'],
        ['rubrique', 'net_N', 'net_N1']);

    addSheet('Compte de Resultat', data.compte_resultat,
        ['Rubrique', 'Montant N', 'Montant N-1'],
        ['rubrique', 'montant_N', 'montant_N1']);

    // KPIs sheet
    if (data.kpis) {
        const k = data.kpis;
        const kpiData = [
            ['Indicateur', 'Valeur N', 'Valeur N-1'],
            ["Chiffre d'Affaires", k.chiffre_affaires_N, k.chiffre_affaires_N1],
            ["Résultat d'Exploitation", k.resultat_exploitation_N, null],
            ["Résultat Net", k.resultat_net_N, null],
            ["EBITDA (estimé)", k.ebitda_estime_N, null],
            ["Total Actif", k.total_actif_N, null],
            ["Total Passif", k.total_passif_N, null],
            ["Capitaux Propres", k.capitaux_propres_N, null],
            [], ["Vérification Équilibre (Actif - Passif)", { f: "B6-B7" }, null],
        ];
        const wsK = XLSX.utils.aoa_to_sheet(kpiData);
        wsK['!cols'] = [{ wch: 40 }, { wch: 18 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, wsK, 'KPIs Dashboard');
    }

    const date = new Date().toISOString().split('T')[0];
    const name = data.meta?.entreprise?.replace(/[^a-zA-Z0-9]/g, '_') || 'Extraction';
    XLSX.writeFile(wb, `LiasseAI_${name}_${date}.xlsx`);
});

// ============================================
//  12. New Extraction
// ============================================
el.newExtractBtn.addEventListener('click', () => {
    state.selectedFile = null; state.extractedData = null; state.pdfInfo = null;
    el.fileInput.value = ''; el.dropZone.classList.remove('has-file');
    el.previewArea.classList.add('hidden'); el.errorArea.classList.add('hidden');
    validateForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

validateForm();
