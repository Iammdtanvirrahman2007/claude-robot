const MODEL = process.env.ROBOT_VISION_MODEL || 'gpt-6-astra'

function normalizeVision(result) {
  const objects = Array.isArray(result?.objects) ? result.objects.map(o => ({
    label: String(o?.label || 'unknown').slice(0, 80),
    confidence: Math.max(0, Math.min(1, Number(o?.confidence) || 0)),
    position: ['left','center','right'].includes(o?.position) ? o.position : 'center',
    distance: ['near','medium','far'].includes(o?.distance) ? o.distance : 'unknown',
  })) : []
  const hazards = Array.isArray(result?.hazards) ? result.hazards.map(x => String(x).slice(0, 120)).slice(0, 12) : []
  const path = {
    clear: result?.path?.clear !== false,
    direction: ['left','center','right','blocked'].includes(result?.path?.direction) ? result.path.direction : 'blocked',
  }
  return {
    scene: String(result?.scene || 'Unknown scene').slice(0, 240),
    objects: objects.slice(0, 30),
    people: Math.max(0, Number(result?.people) || 0),
    obstacles: Math.max(0, Number(result?.obstacles) || 0),
    path,
    hazards,
  }
}

export async function analyzeFrame(imageData, context = {}) {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY is not configured')
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,/i.test(imageData || '')) throw new Error('Expected a base64 JPEG/PNG/WebP image')

  const prompt = [
    'You are the robot vision system.',
    'Analyze this camera frame for safe robot navigation.',
    'Return ONLY JSON. Do not guess hidden objects.',
    'Treat near objects directly ahead as navigation hazards.',
    'Schema: {"scene":"short description","objects":[{"label":"object","confidence":0-1,"position":"left|center|right","distance":"near|medium|far"}],"people":number,"obstacles":number,"path":{"clear":true,"direction":"left|center|right|blocked"},"hazards":[]}',
    'Robot telemetry context: ' + JSON.stringify(context),
  ].join('\n')

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
    body: JSON.stringify({
      model: MODEL,
      input: [{ role: 'user', content: [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: imageData, detail: 'low' },
      ] }],
      max_output_tokens: 500,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error?.message || 'Vision API HTTP ' + response.status)

  const text = body.output_text || (body.output || []).flatMap(x => x.content || []).map(x => x.text || '').join('') || ''
  let result
  try { result = JSON.parse(text) } catch {
    const m = text.match(/\{[\s\S]*\}/)
    result = m ? JSON.parse(m[0]) : null
  }
  if (!result) throw new Error('Vision returned invalid JSON')
  return { ...normalizeVision(result), model: MODEL, analyzedAt: new Date().toISOString() }
}