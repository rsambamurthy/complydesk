/** Product name in one place: renaming the product is a one-line change. Same Integrata identity as VendorGate. */
export const PRODUCT = 'ComplyDesk';
export const COMPANY = 'Integratatech.ai Pvt Ltd';
export const COMPANY_URL = 'https://integratatech.ai';

export const Wordmark = ({ light }: { light?: boolean }) => <span className={`vg-wordmark${light ? ' light' : ''}`}>{PRODUCT}</span>;

export function PoweredBy({ light }: { light?: boolean }) {
  return (
    <a className={`powered-by${light ? ' light' : ''}`} href={COMPANY_URL} target="_blank" rel="noopener noreferrer">
      <img src="/brand/integrata-mark.png" alt="" className="pb-mark" />
      <span>Powered by <Wordmark light={light} /> · <span className="ltr">{COMPANY}</span></span>
    </a>
  );
}
