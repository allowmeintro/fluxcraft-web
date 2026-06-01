/**
 * Replicate API client with polling support
 * Uses server-side polling to avoid Vercel/Next.js timeout issues
 */

const REPLICATE_API_BASE = 'https://api.replicate.com/v1';

export interface ReplicatePrediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: string[];
  error?: string;
  urls?: {
    get: string;
    cancel: string;
  };
}

/**
 * Creates a prediction using Replicate API
 */
async function createPrediction(
  version: string,
  input: Record<string, unknown>,
  apiKey: string
): Promise<ReplicatePrediction> {
  const response = await fetch(`${REPLICATE_API_BASE}/predictions`, {
    method: 'POST',
    headers: {
      'Authorization': `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version,
      input,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Replicate API error: ${error}`);
  }

  return response.json();
}

/**
 * Polls for prediction result with exponential backoff
 * This avoids Vercel/Next.js server timeout issues
 */
export async function runWithPolling(
  version: string,
  input: Record<string, unknown>,
  apiKey: string,
  maxAttempts = 60,
  initialInterval = 500
): Promise<string> {
  // Create prediction
  const prediction = await createPrediction(version, input, apiKey);
  
  // Poll for result
  let attempts = 0;
  let interval = initialInterval;
  
  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, interval));
    
    const response = await fetch(prediction.urls!.get, {
      headers: {
        'Authorization': `Token ${apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch prediction status');
    }

    const result: ReplicatePrediction = await response.json();

    if (result.status === 'succeeded') {
      if (result.output && result.output.length > 0) {
        return result.output[0];
      }
      throw new Error('No output in successful prediction');
    }

    if (result.status === 'failed') {
      throw new Error(result.error || 'Prediction failed');
    }

    if (result.status === 'canceled') {
      throw new Error('Prediction was canceled');
    }

    // Exponential backoff: increase interval by 1.5x each attempt, cap at 5s
    interval = Math.min(interval * 1.5, 5000);
    attempts++;
  }

  throw new Error('Prediction timeout - max attempts reached');
}

/**
 * Generates a landscape image using Replicate (FLUX)
 */
export async function generateLandscapeImage(
  prompt: string,
  width: number = 1024,
  height: number = 576,
  apiKey: string
): Promise<string> {
  // FLUX Schnell model version
  const FLUX_SCHNELL_VERSION = 'e878964614981e7f5611b7621cc3d58d96d5f20190444ce7897ae8c1e5da259e';
  
  const input = {
    prompt,
    aspect_ratio: '16:9',
    output_format: 'png',
    output_quality: 90,
    width,
    height,
    num_outputs: 1,
    guidance_scale: 3.5,
    num_inference_steps: 4,
    scheduler: ' euler_ancestral_discrete',
  };

  return runWithPolling(FLUX_SCHNELL_VERSION, input, apiKey);
}