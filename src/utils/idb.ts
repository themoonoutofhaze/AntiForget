const MAX_UPLOAD_SIZE_BYTES = 2 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const ALLOWED_UPLOAD_MIMES = new Set([
    'application/pdf',
    'application/msword',
    DOCX_MIME,
]);
const ALLOWED_UPLOAD_EXTENSIONS = ['.pdf', '.doc', '.docx'];

const hasAllowedExtension = (fileName: string) => {
    const lower = fileName.toLowerCase();
    return ALLOWED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
};

export const validateUploadFile = (blob: Blob, originalName: string) => {
    if (blob.size > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error('File exceeds 2MB limit. Please upload a smaller PDF, DOC, or DOCX file.');
    }

    const mimeType = (blob.type || '').trim();
    if (!hasAllowedExtension(originalName) || (mimeType && !ALLOWED_UPLOAD_MIMES.has(mimeType))) {
        throw new Error('Only PDF, DOC, and DOCX files are allowed.');
    }
};

export const savePdfBlob = async (id: string, originalName: string, blob: Blob) => {
    validateUploadFile(blob, originalName);

    const formData = new FormData();
    formData.append('topicId', id);
    formData.append('originalName', originalName);
    formData.append('file', blob, originalName);

    const res = await fetch('/api/app/files/upload', {
        method: 'POST',
        body: formData,
    });

    if (res.status === 401) {
        const hadSession = !!localStorage.getItem('synapse_auth_user');
        localStorage.removeItem('synapse_auth_user');
        localStorage.removeItem('synapse_auth_token');
        if (hadSession) window.location.reload();
        throw new Error('Session expired. Please sign in again.');
    }

    if (!res.ok) {
        const text = await res.text();
        try {
            const parsed = JSON.parse(text);
            throw new Error(parsed?.error || text || 'Failed to upload file');
        } catch {
            throw new Error(text || 'Failed to upload file');
        }
    }

    const payload = await res.json().catch(() => null);
    return payload;
};

export const getPdfBlob = async (_id: string) => {
    return null;
};

export const deletePdfBlob = async (id: string) => {
    const res = await fetch(`/api/app/files/${encodeURIComponent(id)}`, {
        method: 'DELETE',
    });

    if (res.status === 401) {
        const hadSession = !!localStorage.getItem('synapse_auth_user');
        localStorage.removeItem('synapse_auth_user');
        localStorage.removeItem('synapse_auth_token');
        if (hadSession) window.location.reload();
        throw new Error('Session expired. Please sign in again.');
    }

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to delete file');
    }
};
