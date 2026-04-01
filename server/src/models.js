export const sanitizeUserModels = (rows = []) => {
  const dedupe = new Set();
  const models = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const id = typeof row?.id === 'string' ? row.id.trim() : '';
    const provider = typeof row?.provider === 'string' ? row.provider.trim() : '';
    const model = typeof row?.model === 'string' ? row.model.trim() : '';

    if (!id || !provider || !model) {
      continue;
    }

    if (dedupe.has(id)) {
      continue;
    }

    dedupe.add(id);
    models.push({
      id,
      provider,
      model,
      reasoning: Boolean(row?.reasoning),
    });
  }

  return models;
};

export const getModelsForProviders = (models = [], providers = []) => {
  const providerSet = new Set(
    Array.isArray(providers)
      ? providers.filter((provider) => typeof provider === 'string' && provider.trim())
      : []
  );

  if (providerSet.size === 0) {
    return [];
  }

  return sanitizeUserModels(models).filter((candidate) => providerSet.has(candidate.provider));
};

export const buildModelQueue = ({ modelPriorityIds, userModels = [], availableProviders = [] }) => {
  const availableCandidates = getModelsForProviders(userModels, availableProviders);
  const availableById = new Map(availableCandidates.map((candidate) => [candidate.id, candidate]));

  const normalizedIds = Array.isArray(modelPriorityIds)
    ? modelPriorityIds.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim())
    : [];

  const dedupe = new Set();
  const prioritized = [];

  for (const id of normalizedIds) {
    if (dedupe.has(id)) {
      continue;
    }
    dedupe.add(id);

    const candidate = availableById.get(id);
    if (candidate) {
      prioritized.push(candidate);
    }
  }

  for (const candidate of availableCandidates) {
    if (!dedupe.has(candidate.id)) {
      dedupe.add(candidate.id);
      prioritized.push(candidate);
    }
  }

  return prioritized;
};
