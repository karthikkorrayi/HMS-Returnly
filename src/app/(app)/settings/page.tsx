import { requireSession } from '@/lib/auth'
import ActionForm from '@/components/ActionForm'
import { saveSettings } from './actions'

export default async function SettingsPage() {
  const { property } = await requireSession(['manager'])

  const fields = [
    {
      name: 'retention_days',
      label: 'Keep unclaimed items (days)',
      value: property.retention_days,
      min: 7,
      max: 730,
      hint: 'Applies to items logged from now on. Agree this with the hotel’s lost property policy.',
    },
    {
      name: 'request_retention_days',
      label: 'Keep closed customer enquiries (days)',
      value: property.request_retention_days,
      min: 30,
      max: 1095,
      hint: 'Rejected or resolved enquiries — with the customer’s name, booking ID and messages — are deleted after this.',
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
