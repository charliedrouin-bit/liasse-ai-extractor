import { GoogleGenerativeAI } from "@google/generative-ai";

// -- Initialisation --
lucide.createIcons();

const elements = {
    apiKeyInput: document.getElementById('api-key'),
    toggleKey: document.getElementById('toggle-key'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    extractBtn: document.getElementById('extract-btn'),
    statusArea: document.getElementById('status-area'),
    statusText: document.getElementById('status-text'),
    resultArea: document.getElementById('result-area'),
    downloadBtn: document.getElementById('download-btn'),
    fileName: document.getElementById('file-name'),
    fileInfo: document.getElementById('file-info')
};

let selectedFile = null;
let extractedData = null;

// -- Gestion de la Clé API --
const savedKey = localStorage.getItem('gemini_api_key');
if (savedKey) {
    elements.apiKeyInput.value = savedKey;
}

elements.apiKeyInput.addEventListener('input', (e) => {
    localStorage.setItem('gemini_api_key', e.target.value);
    validateForm();
});

elements.toggleKey.addEventListener('click', () => {
    const type = elements.apiKeyInput.type === 'password' ? 'text' : 'password';
    elements.apiKeyInput.type = type;
    const icon = type === 'password' ? 'eye' : 'eye-off';
    elements.toggleKey.innerHTML = `<i data-lucide="${icon}"></i>`;
    lucide.createIcons();
});

// -- Gestion du Fichier --
elements.dropZone.addEventListener('click', () => elements.fileInput.click());

elements.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    elements.dropZone.classList.add('dragover');
});

elements.dropZone.addEventListener('dragleave', () => {
    elements.dropZone.classList.remove('dragover');
});

elements.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    elements.dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
        handleFile(e.dataTransfer.files[0]);
    }
});

elements.fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        handleFile(e.target.files[0]);
    }
});

function handleFile(file) {
    if (file.type !== 'application/pdf') {
        alert("Veuillez sélectionner un fichier PDF uniquement.");
        return;
    }
    selectedFile = file;
    elements.fileName.textContent = file.name;
    elements.fileInfo.classList.remove('hidden');
    validateForm();
}

function validateForm() {
    const hasKey = elements.apiKeyInput.value.trim().length > 10;
    const hasFile = selectedFile !== null;
    elements.extractBtn.disabled = !(hasKey && hasFile);
}

// -- Conversion PDF -> Base64 --
async function fileToGenerativePart(file) {
    const base64EncodedDataPromise = new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: { data: await base64EncodedDataPromise, mimeType: file.type },
    };
}

// -- Extraction Gemini --
elements.extractBtn.addEventListener('click', async () => {
    const apiKey = elements.apiKeyInput.value.trim();
    
    // UI Update
    elements.extractBtn.disabled = true;
    elements.statusArea.classList.remove('hidden');
    elements.resultArea.classList.add('hidden');
    elements.statusText.textContent = "L'IA analyse votre document financier...";

    try {
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

        const prompt = `
            Tu es un expert comptable spécialisé dans l'analyse de liasses fiscales.
            Analyse ce document et extrais TOUS les postes du bilan (Actif, Passif) et du Compte de Résultat.
            
            Consignes strictes :
            1. Renvoie UNIQUEMENT un tableau JSON.
            2. Chaque objet doit avoir : "Rubrique", "Net_N", "Net_N_moins_1".
            3. Si un montant est absent ou illisible, utilise 0.
            4. Ne mets aucun texte avant ou après le JSON.
            5. Nettoie les noms de rubriques (pas de codes type 'AA', 'AB').
        `;

        const filePart = await fileToGenerativePart(selectedFile);
        const result = await model.generateContent([prompt, filePart]);
        const response = await result.response;
        let text = response.text();
        
        // Nettoyage du JSON (si Gemini met des balises ```json)
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        
        extractedData = JSON.parse(text);
        
        // Success UI
        elements.statusArea.classList.add('hidden');
        elements.resultArea.classList.remove('hidden');
        
    } catch (error) {
        console.error(error);
        alert("Erreur lors de l'extraction : " + error.message);
        elements.statusArea.classList.add('hidden');
        elements.extractBtn.disabled = false;
    }
});

// -- Génération Excel --
elements.downloadBtn.addEventListener('click', () => {
    if (!extractedData) return;

    const worksheet = XLSX.utils.json_to_sheet(extractedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Extraction Liasse");

    // Formatage basique des colonnes
    const wscols = [
        {wch: 40}, // Rubrique
        {wch: 15}, // Net N
        {wch: 15}  // Net N-1
    ];
    worksheet['!cols'] = wscols;

    // Téléchargement
    const date = new Date().toISOString().split('T')[0];
    XLSX.writeFile(workbook, `Extraction_${date}.xlsx`);
});
