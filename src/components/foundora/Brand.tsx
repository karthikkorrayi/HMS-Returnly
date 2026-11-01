export default function Brand() {
  // A neutral plate preserves the supplied navy/teal brand in both themes.
  // eslint-disable-next-line @next/next/no-img-element -- Local, replaceable brand asset with fixed proportions.
  return (
    <img
      className="foundora-logo"
      src="/foundora-logo.svg"
      alt="Foundora — Lost & Found, Made Simple."
      width="280"
      height="84"
    />
  )
}
