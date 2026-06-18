'use strict';

// Primitivas de similaridade de identificadores compartilhadas pelos analisadores.
// Reune distancia de edicao, colapso de caracteres repetidos, subsequencia e a
// heuristica de melhor candidato usada para sugerir nomes proximos (typos,
// variaveis nao declaradas, imports incorretos).

function levenshteinDistance(a, b) {
  const aRunes = [...String(a || '')];
  const bRunes = [...String(b || '')];
  let previous = Array.from({ length: bRunes.length + 1 }, (_, idx) => idx);
  let current = [];
  for (let i = 0; i < aRunes.length; i += 1) {
    current = [i + 1];
    for (let j = 0; j < bRunes.length; j += 1) {
      const insertion = current[j] + 1;
      const deletion = previous[j + 1] + 1;
      const substitution = previous[j] + (aRunes[i] === bRunes[j] ? 0 : 1);
      current.push(Math.min(insertion, deletion, substitution));
    }
    previous = current;
  }
  return previous[previous.length - 1];
}

function collapseRepeatedChars(value) {
  const chars = String(value || '').toLowerCase();
  if (!chars) {
    return '';
  }
  return chars.split('').filter((char, index, list) => index === 0 || char !== list[index - 1]).join('');
}

function isSubsequence(target, source) {
  if (target.length === 0) {
    return true;
  }
  if (target.length > source.length) {
    return false;
  }
  let i = 0;
  let j = 0;
  while (i < source.length && j < target.length) {
    if (source[i] === target[j]) {
      j += 1;
    }
    i += 1;
  }
  return j === target.length;
}

function suggestSimilarIdentifier(undefinedName, candidates) {
  const normalized = String(undefinedName).trim();
  const normalizedLen = normalized.length;
  const unknown = normalized.toLowerCase();
  const maxDistance = normalizedLen <= 4 ? 2 : normalizedLen <= 7 ? 3 : 4;
  const candidateScores = (Array.isArray(candidates) ? candidates : [])
    .filter(Boolean)
    .filter((candidate, index, arr) => arr.indexOf(candidate) === index)
    .map((candidate) => {
      const normalizedCandidate = candidate.toLowerCase();
      const distance = levenshteinDistance(unknown, normalizedCandidate);
      const collapsedUnknown = collapseRepeatedChars(unknown);
      const collapsedCandidate = collapseRepeatedChars(normalizedCandidate);
      const collapsedDistance = levenshteinDistance(collapsedUnknown, collapsedCandidate);
      const isSubseq = isSubsequence(normalizedCandidate, unknown) || isSubsequence(unknown, normalizedCandidate);
      const firstCharBonus = !normalizedCandidate || unknown[0] !== normalizedCandidate[0] ? 1 : 0;
      const lengthDelta = Math.abs(normalizedCandidate.length - normalizedLen);
      const isRelevant = distance <= maxDistance || collapsedDistance <= 1 || isSubseq;
      return { candidate, distance, collapsedDistance, firstCharBonus, lengthDelta, isSubseq, isRelevant };
    })
    .filter((entry) => entry.isRelevant && entry.distance > 0);

  const strictCandidates = candidateScores.filter((entry) => entry.firstCharBonus === 0);
  const bestPool = strictCandidates.length > 0 ? strictCandidates : candidateScores;
  const finalPool = bestPool.filter((entry) => entry.lengthDelta <= 3);
  const subseqPool = bestPool.filter((entry) => entry.isSubseq && entry.lengthDelta > 3);
  if (subseqPool.length === 0 && finalPool.length === 0) {
    const firstCharMatch = bestPool.filter((entry) => !entry.firstCharBonus && entry.lengthDelta <= 8);
    if (firstCharMatch.length === 1) {
      return firstCharMatch[0].candidate;
    }
    if (firstCharMatch.length > 1) {
      firstCharMatch.sort((a, b) => a.lengthDelta - b.lengthDelta);
      return firstCharMatch[0].candidate;
    }
  }
  if (subseqPool.length > 0) {
    subseqPool.sort((a, b) => a.lengthDelta - b.lengthDelta);
    return subseqPool[0].candidate;
  }
  if (finalPool.length === 0) {
    return null;
  }
  finalPool.sort((a, b) => {
    const scoreA = (a.distance * 10) + (a.collapsedDistance * 4) + (a.firstCharBonus * 2) + (a.lengthDelta * 2) + (a.isSubseq ? 0 : 3);
    const scoreB = (b.distance * 10) + (b.collapsedDistance * 4) + (b.firstCharBonus * 2) + (b.lengthDelta * 2) + (b.isSubseq ? 0 : 3);
    return scoreA - scoreB;
  });
  return finalPool[0].candidate;
}

module.exports = {
  collapseRepeatedChars,
  isSubsequence,
  levenshteinDistance,
  suggestSimilarIdentifier,
};
