/** Byte budget controls source transmission, not a model's token allowance. */
export function ContextSettings({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled: boolean }) {
  return <label className="model-setting">Context limit (bytes)
    <input aria-label="Context limit (bytes)" type="number" min="1" max="2097152" step="1" value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} />
    <small>Source byte budget, including local definitions. This is not a token estimate.</small>
  </label>;
}
