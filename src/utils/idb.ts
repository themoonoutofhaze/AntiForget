import { getCurrentUserId } from './userContext';

export const savePdfBlob = async (id: string, originalName: string, blob: Blob) => {
    const formData = new FormData();
    formData.append('userId', getCurrentUserId());
    formData.append('topicId', id);
    formData.append('originalName', originalName);
    formData.append('file', blob, originalName);

    const res = await fetch('/api/app/files/upload', {
        method: 'POST',
        body: formData,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to upload file');
    }
};

export const getPdfBlob = async (_id: string) => {
    return null;
};

export const deletePdfBlob = async (id: string) => {
    const userId = encodeURIComponent(getCurrentUserId());
    const res = await fetch(`/api/app/files/${encodeURIComponent(id)}?userId=${userId}`, {
        method: 'DELETE',
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Failed to delete file');
    }
};
