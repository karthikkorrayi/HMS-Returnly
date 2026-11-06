import Brand from '@/components/foundora/Brand'
import HotelLogo from '@/components/foundora/HotelLogo'
import ThemeToggle from '@/components/foundora/Theme'
type Hotel = { name:string; inn_code:string; slug:string; has_logo:boolean; logo_version:number }
export default function AuthFrame({ hotel, children }: { hotel?:Hotel; children:React.ReactNode }) {
  return <div className="auth-frame"><header className="auth-hotel-header" data-has-logo={hotel?.has_logo || undefined}><div className="workspace-hotel">
    {hotel?.has_logo && <HotelLogo slug={hotel.slug} version={hotel.logo_version} name={hotel.name}/>}
    <div><p className="font-bold">{hotel?.name ?? 'Hotel staff workspace'}</p><p className="hint">{hotel?.inn_code ?? 'Choose your hotel to sign in'}</p></div>
    </div><ThemeToggle /></header><main className="auth-workspace">{children}</main>
    <footer className="workspace-company-footer"><Brand/><span>FoundOra · Lost &amp; Found, Made Simple.</span></footer></div>
}
