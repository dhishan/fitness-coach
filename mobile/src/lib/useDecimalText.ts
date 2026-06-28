import { useEffect, useState } from 'react'

/**
 * Controlled numeric TextInput helper that survives partial decimals.
 *
 * Binding a TextInput's value straight to a parsed number strips the dot before
 * you can finish typing ("0." -> 0 -> "0", so "0.5" is unreachable). This keeps
 * the raw text locally, parses for the model, and re-syncs only when the number
 * changes from the outside (steppers, auto-fill).
 *
 *   const w = useDecimalText(weight, (v) => setWeight(v))
 *   <TextInput value={w.text} onChangeText={w.onChangeText} keyboardType="decimal-pad" />
 */
export function useDecimalText(
  value: number,
  onChange: (v: number) => void,
  opts: { blankZero?: boolean } = {},
) {
  const fmt = (n: number) => (opts.blankZero && n === 0 ? '' : String(n))
  const [text, setText] = useState(() => fmt(value))

  useEffect(() => {
    if ((parseFloat(text) || 0) !== value) setText(fmt(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const onChangeText = (t: string) => {
    // digits + a single decimal point only
    const cleaned = t.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
    setText(cleaned)
    onChange(parseFloat(cleaned) || 0)
  }

  return { text, onChangeText }
}
