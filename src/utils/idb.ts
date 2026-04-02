export const savePdfBlob = async (id: string, originalName: string, blob: Blob) => {
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
        throw new Error(text || 'Failed to upload file');
    }
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
