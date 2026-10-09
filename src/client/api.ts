export async function api<T>(operation: string, input: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/${operation}`, { method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? 'Request failed.');
  return value as T;
}
