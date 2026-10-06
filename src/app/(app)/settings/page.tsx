import { requireSession } from '@/lib/auth'
import ActionForm from '@/components/ActionForm'
import { saveSettings } from './actions'

export default async function SettingsPage() {
  const { property } = await requireSession(['manager'])

  const fields = [
    {
      name: 'trace_window_days',
      label: 'Trace window (days)',
      value: property.trace_window_days,
      min: 7,
      max: 120,
      hint: 'How far back to look for possible owners of an item found in a room.',
    },
    {
      name: 'check_due_hours',
      label: 'Room check deadline (hours)',
      value: property.check_due_hours,
      min: 1,
      max: 48,
      hint: 'A departed room not checked within this time is flagged as overdue.',
    },
    {
      name: 'stay_retention_days',
      label: 'Keep stay records (days)',
      value: property.stay_retention_days,
      min: 30,
      max: 730,
      hint: 'Stays older than this are deleted. Must be at least the trace window.',
    },
    {
      name: 'retention_days',
      label: 'Keep unclaimed items (days)',
      value: property.retention_days,
      min: 7,
      max: 730,
      hint: 'Applies to items logged from now on. Agree this with the hotel’s lost property policy.',
    },
  ]

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="hint mt-1">{property.name} ({property.inn_code})</p>
      </div>
      <section className="panel p-4 sm:p-5">
        <ActionForm action={saveSettings} submitLabel="Save settings">
          {fields.map((f) => (
            <div key={f.name}>
              <label htmlFor={f.name} className="label">{f.label}</label>
              <input
                id={f.name}
                name={f.name}
                type="number"
                inputMode="numeric"
                min={f.min}
                max={f.max}
                defaultValue={f.value}
                className="field sm:w-40"
                required
              />
              <p className="hint mt-1">{f.hint}</p>
            </div>
          ))}
        </ActionForm>
      </section>
    </div>
  )
}
