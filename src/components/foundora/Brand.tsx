export default function Brand() {
  return <span className="platform-brand" aria-label="FoundOra — Lost & Found, Made Simple.">
    {/* eslint-disable-next-line @next/next/no-img-element -- local theme-specific branding */}
    <img className="foundora-logo brand-light" src="/branding/foundora-light.png" alt="FoundOra — Lost & Found, Made Simple." width="360" height="120" />
    {/* eslint-disable-next-line @next/next/no-img-element -- local theme-specific branding */}
    <img className="foundora-logo brand-dark" src="/branding/foundora-dark.png" alt="FoundOra — Lost & Found, Made Simple." width="360" height="120" />
  </span>
}
