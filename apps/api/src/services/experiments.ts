import type { Env } from "../types";

interface ExperimentPrediction {
  card_id: string;
  grade: string;
  grading_company: string;
  model_version: string;
  fair_value: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  buy_threshold: number;
  sell_threshold: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  volume_bucket: "high" | "medium" | "low";
}

interface ActiveExperiment {
  id: number;
  name: string;
  challenger_version_key: string;
  sample_rate: number;
}

interface ExperimentAssignment {
  variant: "control" | "challenger";
  experiment: {
    id: number;
    name: string;
    challenger_version_key: string;
  };
  prediction: ExperimentPrediction | null;
}

const experimentPredictionCache = new Map<string, { loadedAt: number; predictions: Map<string, ExperimentPrediction> }>();
const CACHE_TTL_MS = 10 * 60 * 1000;

function predictionKey(cardId: string, gradingCompany: string, grade: string): string {
  return `${cardId}:${gradingCompany}:${grade}`;
}

async function hashToUnitInterval(input: string): Promise<number> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let value = 0;
  for (let i = 0; i < 4; i++) {
    value = (value << 8) | view[i];
  }
  return value / 0xffffffff;
}

async function loadExperimentPredictions(
  env: Env,
  versionKey: string
): Promise<Map<string, ExperimentPrediction> | null> {
  const cached = experimentPredictionCache.get(versionKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
    return cached.predictions;
  }

  const obj = await env.MODELS.get(versionKey);
  if (!obj) {
    return null;
  }

  const predictions = (await obj.json()) as ExperimentPrediction[];
  const map = new Map<string, ExperimentPrediction>();
  for (const prediction of predictions) {
    map.set(predictionKey(prediction.card_id, prediction.grading_company, prediction.grade), prediction);
  }

  experimentPredictionCache.set(versionKey, { loadedAt: Date.now(), predictions: map });
  return map;
}

export async function resolveExperimentAssignment(
  env: Env,
  assignmentKey: string,
  cardId: string,
  gradingCompany: string,
  grade: string
): Promise<ExperimentAssignment | null> {
  const experiment = await env.DB.prepare(
    `SELECT id, name, challenger_version_key, sample_rate
     FROM model_experiments
     WHERE status = 'running'
     ORDER BY started_at DESC, created_at DESC
     LIMIT 1`
  )
    .bind()
    .first<ActiveExperiment>();

  if (!experiment) {
    return null;
  }

  const bucket = await hashToUnitInterval(`${experiment.id}:${assignmentKey}`);
  const variant: "control" | "challenger" = bucket < experiment.sample_rate ? "challenger" : "control";

  let prediction: ExperimentPrediction | null = null;
  let resolvedVariant: "control" | "challenger" = variant;
  if (variant === "challenger") {
    const predictions = await loadExperimentPredictions(env, experiment.challenger_version_key);
    prediction = predictions?.get(predictionKey(cardId, gradingCompany, grade)) || null;
    if (!prediction) {
      resolvedVariant = "control";
    }
  }

  await env.DB.prepare(
    `INSERT INTO model_experiment_events
       (experiment_id, assignment_key, card_id, grade, grading_company, variant, model_version, fair_value)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      experiment.id,
      assignmentKey,
      cardId,
      grade,
      gradingCompany,
      resolvedVariant,
      prediction?.model_version || null,
      prediction?.fair_value || null
    )
    .run();

  return {
    variant: resolvedVariant,
    experiment: {
      id: experiment.id,
      name: experiment.name,
      challenger_version_key: experiment.challenger_version_key,
    },
    prediction,
  };
}
