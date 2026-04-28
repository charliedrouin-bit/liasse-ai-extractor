import { GoogleGenerativeAI } from "@google/generative-ai";

// ============================================
//  LiasseAI — Application Core
//  Model: gemini-2.0-flash
//  Architecture: 100% Client-Side
// ============================================

lucide.createIcons();

// -- État global --
const state = {
    selectedFile: null,
    extractedData: null, // { bilan_actif, bilan_passif, compte_resultat, kpis }
};

// -- Références DOM --
const el = {
    apiKey: document.getElementById('api-key'),
    toggleKey: document.getElementById('toggle-key'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    fileInfo: document.getElementById('file-info'),
    fileName: document.getElementById('file-name'),
    fileSize: document.getElementById('file-size'),
    removeFile: document.getElementById('remove-file'),
    extractBtn: document.getElementById('extract-btn'),
    // Logs
    logArea: document.getElementById('log-area'),
    logTitle: document.getElementById('log-title'),
    logEntries: document.getElementById('log-entries'),
    // Error
    errorArea: document.getElementById('error-area'),
    errorMessage: document.getElementById('error-message'),
    retryBtn: document.getElementById('retry-btn'),
    // Preview
    previewArea: document.getElementById('preview-area'),
    downloadBtn: document.getElementById('download-btn'),
    newExtractBtn: document.getElementById('new-extract-btn'),
    // Tables
    tableActif: document.querySelector('#table-actif tbody'),
    tablePassif: document.querySelector('#table-passif tbody'),
    tableResultat: document.querySelector('#table-resultat tbody'),
    kpiGrid: document.getElementById('kpi-grid'),
    balanceCheck: document.getElementById('balance-check'),
};

// ============================================
//  SECTION 1 : Clé API
// ============================================

const savedKey = localStorage.getItem('gemini_api_key');
if (savedKey) el.apiKey.value = savedKey;

el.apiKey.addEventListener('input', (e) => {
    localStorage.setItem('gemini_api_key', e.target.value.trim());
    validateForm();
});

el.toggleKey.addEventListener('click', () => {
    const isPassword = el.apiKey.type === 'password';
    el.apiKey.type = isPassword ? 'text' : 'password';
    el.toggleKey.innerHTML = `<i data-lucide="${isPassword ? 'eye-off' : 'eye'}"></i>`;
    lucide.createIcons();
});

// ============================================
//  SECTION 2 : Gestion du Fichier
// ============================================

el.dropZone.addEventListener('click', (e) => {
    if (e.target === el.removeFile || el.removeFile.contains(e.target)) return;
    el.fileInput.click();
});

el.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    el.dropZone.classList.add('dragover');
});

el.dropZone.addEventListener('dragleave', () => el.dropZone.classList.remove('dragover'));

el.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    el.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
});

el.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) handleFile(e.target.files[0]);
});

el.removeFile.addEventListener('click', (e) => {
    e.stopPropagation();
    resetFile();
});

function handleFile(file) {
    if (file.type !== 'application/pdf') {
        showError("Format invalide. Veuillez sélectionner un fichier PDF.");
        return;
    }
    state.selectedFile = file;
    el.fileName.textContent = file.name;
    el.fileSize.textContent = `(${(file.size / 1024 / 1024).toFixed(2)} Mo)`;
    el.dropZone.classList.add('has-file');
    validateForm();
}

function resetFile() {
    state.selectedFile = null;
    el.fileInput.value = '';
    el.dropZone.classList.remove('has-file');
    validateForm();
}

function validateForm() {
    const hasKey = el.apiKey.value.trim().length > 10;
    const hasFile = state.selectedFile !== null;
    el.extractBtn.disabled = !(hasKey && hasFile);
}

// ============================================
//  SECTION 3 : Logs de Traitement
// ============================================

const LOG_STEPS = [
    { id: 'read',     icon: 'file-search',    text: 'Lecture et encodage du PDF...' },
    { id: 'send',     icon: 'send',           text: 'Envoi à Gemini AI...' },
    { id: 'analyse',  icon: 'brain',          text: 'Analyse du bilan et compte de résultat...' },
    { id: 'parse',    icon: 'code-2',         text: 'Structuration des données JSON...' },
    { id: 'render',   icon: 'table-2',        text: 'Construction du tableau de prévisualisation...' },
];

function addLog(id, status, customText = null) {
    const existing = document.getElementById(`log-${id}`);
    const icons = { pending: 'circle', active: 'loader', done: 'check-circle', error: 'x-circle' };
    const step = LOG_STEPS.find(s => s.id === id);
    const text = customText || step.text;

    const html = `
        <div class="log-entry ${status}" id="log-${id}">
            <i data-lucide="${icons[status]}"></i>
            <span>${text}</span>
        </div>
    `;

    if (existing) {
        existing.outerHTML = html;
    } else {
        el.logEntries.insertAdjacentHTML('beforeend', html);
    }
    lucide.createIcons();
}

function showLogs() {
    el.logArea.classList.remove('hidden');
    el.errorArea.classList.add('hidden');
    el.previewArea.classList.add('hidden');
    el.logEntries.innerHTML = '';
}

function hideLogs() {
    el.logArea.classList.add('hidden');
}

// ============================================
//  SECTION 4 : Gestion des Erreurs
// ============================================

function showError(message) {
    hideLogs();
    el.errorArea.classList.remove('hidden');
    el.errorMessage.textContent = message;
    el.extractBtn.disabled = false;
    lucide.createIcons();
}

el.retryBtn.addEventListener('click', () => {
    el.errorArea.classList.add('hidden');
    validateForm();
});

// ============================================
//  SECTION 5 : Conversion PDF → Base64
// ============================================

async function fileToBase64Part(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve({
            inlineData: {
                data: reader.result.split(',')[1],
                mimeType: 'application/pdf',
            }
        });
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ============================================
//  SECTION 6 : Prompt Audit-Ready
// ============================================

const EXTRACTION_PROMPT = `
Tu es un expert-comptable spécialisé en analyse de liasses fiscales françaises et marocaines (PCG, CPC marocain).

MISSION : Analyse ce document PDF et extrais les données financières structurées.

RÈGLES ABSOLUES :
1. Réponds UNIQUEMENT avec un objet JSON valide. Zéro texte avant ou après.
2. Pas de commentaires, pas de markdown, pas de balises \`\`\`.
3. Si une valeur est absente ou illisible : utilise null (pas 0, pas "").
4. Nettoie les libellés : supprime les codes comptables (AA, AB, etc.) et garde uniquement le libellé clair.
5. Les montants sont en unités de la devise (euros ou dirhams). Pas de symboles.
6. "N" = exercice en cours (dernière colonne montant). "N_1" = exercice précédent.

STRUCTURE JSON ATTENDUE :
{
  "meta": {
    "entreprise": "Nom de la société ou null",
    "exercice_N": "Année N ou null",
    "exercice_N1": "Année N-1 ou null",
    "devise": "EUR ou MAD ou autre",
    "format": "FR_CERFA ou MA_CPC ou AUTRE"
  },
  "bilan_actif": [
    { "rubrique": "Libellé du poste", "brut": 0, "amort": 0, "net_N": 0, "net_N1": 0 }
  ],
  "bilan_passif": [
    { "rubrique": "Libellé du poste", "net_N": 0, "net_N1": 0 }
  ],
  "compte_resultat": [
    { "rubrique": "Libellé du poste", "montant_N": 0, "montant_N1": 0 }
  ],
  "kpis": {
    "chiffre_affaires_N": null,
    "chiffre_affaires_N1": null,
    "resultat_exploitation_N": null,
    "resultat_net_N": null,
    "total_actif_N": null,
    "total_passif_N": null,
    "capitaux_propres_N": null,
    "ebitda_estime_N": null
  }
}

Commence l'extraction maintenant.
`;

// ============================================
//  SECTION 7 : Extraction Gemini
// ============================================

el.extractBtn.addEventListener('click', async () => {
    const apiKey = el.apiKey.value.trim();
    el.extractBtn.disabled = true;
    showLogs();
    el.logTitle.textContent = "Analyse en cours...";

    try {
        // Étape 1 : Lecture PDF
        addLog('read', 'active');
        const filePart = await fileToBase64Part(state.selectedFile);
        addLog('read', 'done');

        // Étape 2 : Connexion Gemini
        addLog('send', 'active');
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
            }
        });
        addLog('send', 'done');

        // Étape 3 : Analyse IA
        addLog('analyse', 'active');
        const result = await model.generateContent([EXTRACTION_PROMPT, filePart]);
        const response = await result.response;
        let text = response.text();
        addLog('analyse', 'done');

        // Étape 4 : Parsing JSON
        addLog('parse', 'active');
        text = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        state.extractedData = JSON.parse(text);
        addLog('parse', 'done');

        // Étape 5 : Rendu
        addLog('render', 'active');
        renderPreview(state.extractedData);
        addLog('render', 'done');

        // Succès
        el.logTitle.textContent = "✓ Analyse terminée !";
        setTimeout(() => {
            hideLogs();
            el.previewArea.classList.remove('hidden');
            lucide.createIcons();
        }, 800);

    } catch (error) {
        console.error('[LiasseAI Error]', error);
        const msg = error.message || "Erreur inconnue.";
        let advice = "";
        if (msg.includes("404")) advice = "Vérifiez le nom du modèle ou votre région d'accès.";
        else if (msg.includes("API key")) advice = "Votre clé API est invalide ou expirée. Vérifiez sur aistudio.google.com.";
        else if (msg.includes("JSON")) advice = "L'IA n'a pas renvoyé un JSON valide. Réessayez, cela peut arriver sur des documents complexes.";
        else if (msg.includes("quota")) advice = "Quota API dépassé. Attendez quelques minutes.";
        showError(`${msg}${advice ? '\n\nConseil : ' + advice : ''}`);
    }
});

// ============================================
//  SECTION 8 : Rendu de la Prévisualisation
// ============================================

function formatNum(val) {
    if (val === null || val === undefined) return '—';
    return Number(val).toLocaleString('fr-FR');
}

function variationClass(n, n1) {
    if (n === null || n1 === null || n1 === 0) return 'var-neutral';
    return n >= n1 ? 'var-positive' : 'var-negative';
}

function variationText(n, n1) {
    if (n === null || n1 === null || n1 === 0) return '—';
    const pct = ((n - n1) / Math.abs(n1) * 100).toFixed(1);
    return `${pct > 0 ? '+' : ''}${pct}%`;
}

function buildTableRows(tbody, rows, keyN, keyN1) {
    tbody.innerHTML = '';
    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--text-dimmed);padding:1.5rem;">Aucune donnée extraite</td></tr>';
        return;
    }

    rows.forEach((row, i) => {
        const n = row[keyN];
        const n1 = row[keyN1];
        const isTotal = row.rubrique?.toLowerCase().includes('total');
        const tr = document.createElement('tr');
        if (isTotal) tr.classList.add('row-total');

        const varClass = variationClass(n, n1);
        const varTxt = variationText(n, n1);

        tr.innerHTML = `
            <td contenteditable="true" data-field="rubrique" data-idx="${i}">${row.rubrique || ''}</td>
            <td contenteditable="true" data-field="${keyN}" data-idx="${i}" class="num-cell">${formatNum(n)}</td>
            <td contenteditable="true" data-field="${keyN1}" data-idx="${i}" class="num-cell">${formatNum(n1)}</td>
            <td class="${varClass}">${varTxt}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderPreview(data) {
    buildTableRows(el.tableActif, data.bilan_actif, 'net_N', 'net_N1');
    buildTableRows(el.tablePassif, data.bilan_passif, 'net_N', 'net_N1');
    buildTableRows(el.tableResultat, data.compte_resultat, 'montant_N', 'montant_N1');
    renderKPIs(data.kpis, data.meta);
    checkBalance(data.kpis);
}

function renderKPIs(kpis, meta) {
    el.kpiGrid.innerHTML = '';
    if (!kpis) return;

    const definitions = [
        { key: 'chiffre_affaires_N', label: "Chiffre d'Affaires N", icon: 'bar-chart-2', color: 'primary' },
        { key: 'resultat_exploitation_N', label: "Résultat d'Exploitation", icon: 'trending-up', color: 'success' },
        { key: 'resultat_net_N', label: "Résultat Net", icon: 'circle-dollar-sign', color: 'success' },
        { key: 'ebitda_estime_N', label: "EBITDA (estimé)", icon: 'activity', color: 'accent' },
        { key: 'total_actif_N', label: "Total Actif", icon: 'layers', color: 'primary' },
        { key: 'capitaux_propres_N', label: "Capitaux Propres", icon: 'landmark', color: 'primary' },
    ];

    definitions.forEach(def => {
        const val = kpis[def.key];
        const valN1Key = def.key.replace('_N', '_N1');
        const valN1 = kpis[valN1Key] || null;
        const varTxt = variationText(val, valN1);
        const varClass = variationClass(val, valN1);

        const card = document.createElement('div');
        card.className = 'kpi-card';
        card.innerHTML = `
            <p class="kpi-label">${def.label}</p>
            <p class="kpi-value">${formatNum(val)}</p>
            ${varTxt !== '—' ? `<p class="kpi-change ${varClass}">${varTxt} vs N-1</p>` : ''}
        `;
        el.kpiGrid.appendChild(card);
    });

    // Infos méta
    if (meta) {
        const metaCard = document.createElement('div');
        metaCard.className = 'kpi-card';
        metaCard.innerHTML = `
            <p class="kpi-label">Document</p>
            <p class="kpi-value" style="font-size:1rem">${meta.entreprise || '—'}</p>
            <p class="kpi-change var-neutral">${meta.exercice_N || ''} · ${meta.devise || ''} · ${meta.format || ''}</p>
        `;
        el.kpiGrid.prepend(metaCard);
    }
}

function checkBalance(kpis) {
    if (!kpis) return;
    const actif = kpis.total_actif_N;
    const passif = kpis.total_passif_N;
    if (actif === null || passif === null) {
        el.balanceCheck.innerHTML = '';
        return;
    }
    const diff = Math.abs(actif - passif);
    const isBalanced = diff < 1;
    el.balanceCheck.className = `balance-check ${isBalanced ? 'balanced' : 'unbalanced'}`;
    el.balanceCheck.innerHTML = isBalanced
        ? `<i data-lucide="check-circle"></i> Bilan équilibré — Actif = Passif = ${formatNum(actif)}`
        : `<i data-lucide="alert-triangle"></i> Écart détecté : Actif (${formatNum(actif)}) ≠ Passif (${formatNum(passif)}) | Différence : ${formatNum(diff)}`;
    lucide.createIcons();
}

// ============================================
//  SECTION 9 : Navigation par Onglets
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
//  SECTION 10 : Génération Excel Multi-Onglets
// ============================================

el.downloadBtn.addEventListener('click', () => {
    if (!state.extractedData) return;
    const data = state.extractedData;
    const wb = XLSX.utils.book_new();

    // -- Styles (header color via sheetjs-style) --
    const headerStyle = {
        font: { bold: true, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1E3A5F" } },
        alignment: { horizontal: "center" },
        border: { bottom: { style: "thin", color: { rgb: "3B82F6" } } }
    };

    // Helper : Ajouter un onglet stylisé
    function addSheet(name, rows, headers, keys) {
        if (!rows || rows.length === 0) return;
        const wsData = [headers, ...rows.map(r => keys.map(k => r[k] ?? null))];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Largeur des colonnes
        ws['!cols'] = headers.map((h, i) => ({ wch: i === 0 ? 45 : 18 }));

        // Formule de vérification Total
        const lastRow = rows.length + 1;
        const netNCol = XLSX.utils.encode_col(1);
        const netN1Col = XLSX.utils.encode_col(2);

        // Ligne de total avec formule SOMME
        const totalRow = ['TOTAL (calculé)', { f: `SUM(${netNCol}2:${netNCol}${lastRow})` }, { f: `SUM(${netN1Col}2:${netN1Col}${lastRow})` }];
        XLSX.utils.sheet_add_aoa(ws, [totalRow], { origin: `A${lastRow + 2}` });

        XLSX.utils.book_append_sheet(wb, ws, name);
    }

    // Onglet Bilan Actif
    addSheet(
        '📊 Bilan Actif',
        data.bilan_actif,
        ['Rubrique', 'Brut', 'Amort./Prov.', 'Net N', 'Net N-1'],
        ['rubrique', 'brut', 'amort', 'net_N', 'net_N1']
    );

    // Onglet Bilan Passif
    addSheet(
        '📊 Bilan Passif',
        data.bilan_passif,
        ['Rubrique', 'Net N', 'Net N-1'],
        ['rubrique', 'net_N', 'net_N1']
    );

    // Onglet Compte de Résultat
    addSheet(
        '📈 Compte de Résultat',
        data.compte_resultat,
        ['Rubrique', 'Montant N', 'Montant N-1'],
        ['rubrique', 'montant_N', 'montant_N1']
    );

    // Onglet Dashboard KPIs
    if (data.kpis) {
        const kpiRows = [
            ['Indicateur', 'Valeur N', 'Valeur N-1'],
            ["Chiffre d'Affaires", data.kpis.chiffre_affaires_N, data.kpis.chiffre_affaires_N1],
            ["Résultat d'Exploitation", data.kpis.resultat_exploitation_N, null],
            ["Résultat Net", data.kpis.resultat_net_N, null],
            ["EBITDA (estimé)", data.kpis.ebitda_estime_N, null],
            ["Total Actif", data.kpis.total_actif_N, null],
            ["Total Passif", data.kpis.total_passif_N, null],
            ["Capitaux Propres", data.kpis.capitaux_propres_N, null],
            [],
            ["✅ Vérification Équilibre", "=B7-B8", null],
        ];
        const wsKPI = XLSX.utils.aoa_to_sheet(kpiRows);
        wsKPI['!cols'] = [{ wch: 35 }, { wch: 18 }, { wch: 18 }];
        XLSX.utils.book_append_sheet(wb, wsKPI, '🎯 KPIs Dashboard');
    }

    // Téléchargement
    const date = new Date().toISOString().split('T')[0];
    const name = data.meta?.entreprise?.replace(/\s+/g, '_') || 'Extraction';
    XLSX.writeFile(wb, `LiasseAI_${name}_${date}.xlsx`);
});

// ============================================
//  SECTION 11 : Nouvelle Extraction
// ============================================

el.newExtractBtn.addEventListener('click', () => {
    state.selectedFile = null;
    state.extractedData = null;
    el.fileInput.value = '';
    el.dropZone.classList.remove('has-file');
    el.previewArea.classList.add('hidden');
    el.errorArea.classList.add('hidden');
    validateForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
});

// Init
validateForm();
