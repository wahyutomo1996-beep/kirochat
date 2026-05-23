import { NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-key-auth';
import { getAllModels, toOpenAIFormat } from '@/lib/models';

/**
 * OpenAI-compatible: GET /v1/models
 *
 * Returns the list of all available models in OpenAI format.
 * Authenticated via Bearer API key (pmt-...).
 */
export async function GET(request: Request) {
  try {
    await requireApiKey(request);

    const models = getAllModels();
    const data = toOpenAIFormat(models);

    return NextResponse.json({
      object: 'list',
      data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unauthorized';
    return NextResponse.json(
      { error: { message, type: 'invalid_request_error', code: 'invalid_api_key' } },
      { status: 401 },
    );
  }
}

// CORS preflight for browser usage
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    },
  });
}
