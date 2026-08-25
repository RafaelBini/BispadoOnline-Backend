const { google } = require('googleapis');

const SCOPES = [
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/drive',
];
const SACRAMENTAL_FOLDER_ID = '13cuJyhHSmFmNzdl07Wdx1KKDPF-4tjKU';

function createOAuth2Client() {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:4500';
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_SECRET,
        `${backendUrl}/google/oauth/callback`
    );
}

function getGoogleAuthUrl() {
    const oauth2 = createOAuth2Client();
    return oauth2.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: SCOPES,
    });
}

async function exchangeGoogleAuthCode(code) {
    const oauth2 = createOAuth2Client();
    const { tokens } = await oauth2.getToken(code);
    return tokens;
}

async function getAuthenticatedClient(accessToken, refreshToken) {
    if (!accessToken) {
        const err = new Error('Token do Google Drive não informado. Faça login novamente.');
        err.googleAuthRequired = true;
        throw err;
    }

    const oauth2 = createOAuth2Client();
    oauth2.setCredentials({
        access_token: accessToken,
        refresh_token: refreshToken,
    });

    try {
        await oauth2.getTokenInfo(accessToken);
        return { oauth2, refreshedTokens: null };
    } catch {
        if (!refreshToken) {
            const err = new Error('Sessão do Google Drive expirada. Faça login novamente.');
            err.googleAuthRequired = true;
            throw err;
        }
        try {
            const { credentials } = await oauth2.refreshAccessToken();
            oauth2.setCredentials(credentials);
            return { oauth2, refreshedTokens: credentials };
        } catch (ex) {
            const err = new Error('Não foi possível renovar o token do Google Drive. Faça login novamente.');
            err.googleAuthRequired = true;
            throw err;
        }
    }
}

function getCoolDate(dt) {
    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const d = new Date(new Date(dt).getTime() + (1000 * 60 * 60 * 3));
    return `${d.toISOString().substr(8, 2)} ${monthNames[d.getMonth()]} ${d.getFullYear()}`;
}

function collectTextRuns(content, runs = []) {
    if (!content) return runs;
    for (const item of content) {
        if (item.paragraph) {
            for (const el of item.paragraph.elements || []) {
                if (el.textRun?.content) {
                    runs.push({
                        startIndex: el.startIndex,
                        endIndex: el.endIndex,
                        content: el.textRun.content,
                    });
                }
            }
        }
        if (item.table) {
            for (const row of item.table.tableRows || []) {
                for (const cell of row.tableCells || []) {
                    for (const cellContent of cell.content || []) {
                        collectTextRuns([cellContent], runs);
                    }
                }
            }
        }
    }
    return runs.sort((a, b) => a.startIndex - b.startIndex);
}

function buildDocumentTextIndex(runs) {
    let text = '';
    const charToDocIndex = [];
    for (const run of runs) {
        for (let i = 0; i < run.content.length; i++) {
            charToDocIndex.push(run.startIndex + i);
        }
        text += run.content;
    }
    return { text, charToDocIndex };
}

function buildOradorEdit(text, charToDocIndex, label, newName) {
    const labelIndex = text.indexOf(label);
    if (labelIndex === -1) return null;

    let pos = labelIndex + label.length;
    while (pos < text.length && text[pos] === ' ') pos++;

    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd === -1) lineEnd = text.length;

    const existingText = text.substring(pos, lineEnd);
    const requests = [];
    const insertIndex = charToDocIndex[pos];

    if (existingText.length > 0) {
        requests.push({
            deleteContentRange: {
                range: {
                    startIndex: charToDocIndex[pos],
                    endIndex: charToDocIndex[lineEnd - 1] + 1,
                },
            },
        });
    }

    requests.push({
        insertText: {
            text: existingText.length > 0 ? newName.trim() : ` ${newName.trim()}`,
            location: { index: insertIndex },
        },
    });

    return { requests, insertIndex, label };
}

async function findSacramentalAtaFile(drive, sacramentalDate) {
    const datePart = getCoolDate(sacramentalDate);
    const resp = await drive.files.list({
        q: `'${SACRAMENTAL_FOLDER_ID}' in parents and mimeType='application/vnd.google-apps.document' and trashed=false`,
        fields: 'files(id, name)',
    });

    return resp.data.files.find((file) => {
        const match = file.name.match(/^\d+\.\s+(.+)$/);
        return match && match[1] === datePart;
    });
}

async function addDiscursantesAta(oauth2, { sacramental_date, discursante_1, discursante_2, discursante_3 }) {
    const oradores = [
        { label: 'Primeiro orador:', name: String(discursante_1).trim() },
        { label: 'Segundo orador:', name: discursante_2 ? String(discursante_2).trim() : '' },
        { label: 'Terceiro orador:', name: discursante_3 ? String(discursante_3).trim() : '' },
    ].filter((o) => o.name);

    const drive = google.drive({ version: 'v3', auth: oauth2 });
    const ataFile = await findSacramentalAtaFile(drive, sacramental_date);

    if (!ataFile) {
        const datePart = getCoolDate(sacramental_date);
        const err = new Error(`Não foi encontrada ata de reunião sacramental com a data ${datePart} na pasta de Reuniões Sacramentais.`);
        err.statusCode = 404;
        throw err;
    }

    const docs = google.docs({ version: 'v1', auth: oauth2 });
    const doc = await docs.documents.get({ documentId: ataFile.id });
    const runs = collectTextRuns(doc.data.body.content);
    const { text, charToDocIndex } = buildDocumentTextIndex(runs);

    const edits = [];
    const notFoundLabels = [];

    for (const orador of oradores) {
        const edit = buildOradorEdit(text, charToDocIndex, orador.label, orador.name);
        if (edit) edits.push(edit);
        else notFoundLabels.push(orador.label.replace(':', ''));
    }

    if (edits.length === 0) {
        const err = new Error(`Documento "${ataFile.name}" encontrado, mas nenhum dos rótulos "Primeiro orador:", "Segundo orador:" ou "Terceiro orador:" foi localizado.`);
        err.statusCode = 404;
        err.docId = ataFile.id;
        err.docUrl = `https://docs.google.com/document/d/${ataFile.id}/edit`;
        throw err;
    }

    edits.sort((a, b) => b.insertIndex - a.insertIndex);
    const requests = edits.flatMap((edit) => edit.requests);

    await docs.documents.batchUpdate({
        documentId: ataFile.id,
        requestBody: { requests },
    });

    return {
        success: true,
        message: `Discursantes atualizados em "${ataFile.name}".`,
        docId: ataFile.id,
        docUrl: `https://docs.google.com/document/d/${ataFile.id}/edit`,
        updated: edits.map((e) => e.label.replace(':', '')).reverse(),
        notFound: notFoundLabels,
    };
}

module.exports = {
    SCOPES,
    getGoogleAuthUrl,
    exchangeGoogleAuthCode,
    getAuthenticatedClient,
    addDiscursantesAta,
};
