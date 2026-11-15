/** Parses a Twilio webhook's form body into the string params its signature covers. */
export async function readTwilioParams(request: Request): Promise<Record<string, string>> {
  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === 'string') params[key] = value;
  return params;
}
