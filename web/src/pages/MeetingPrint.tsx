/** Printable notice with agenda, or minutes — opens in its own tab; the browser's Print saves it as PDF. */
import { useParams, useSearchParams } from 'react-router-dom';
import { useLoad } from '../lib/hooks';
import { fmtDate } from '../lib/format';
import { Spinner, Alert } from '../components/ui';
import { MODE } from '../components/Meetings';

export function MeetingPrint() {
  const { id, doc } = useParams();
  const [qs] = useSearchParams();
  const { data, error } = useLoad<any>(`/meetings/${id}`);
  if (error) return <Alert kind="error">{error}</Alert>;
  if (!data) return <Spinner />;
  const { meeting: x, client, items } = data;
  const board = x.type === 'BOARD';
  const where = x.mode === 'VIDEO' ? 'through video conferencing' : `at ${x.venue ?? client.registeredOffice ?? '___'}${x.mode === 'HYBRID' ? ' (also through video conferencing)' : ''}`;
  return (
    <div className="print-page" style={{ maxWidth: 760, margin: '24px auto', padding: '0 24px', fontFamily: 'Georgia, "Times New Roman", serif', lineHeight: 1.6, color: '#111' }}>
      <style>{'body { background: #fff } @media print { .no-print { display: none } } .print-page h1, .print-page h2 { font-family: inherit }'}</style>
      <div className="no-print" style={{ textAlign: 'right', marginBottom: 12 }}><button className="btn btn-primary btn-sm" onClick={() => window.print()}>Print / save as PDF</button></div>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: 0 }}>{client.name.toUpperCase()}</h2>
        <div>CIN: {client.cin}</div>
        {client.registeredOffice && <div>Registered office: {client.registeredOffice}</div>}
      </div>
      <hr />
      {doc === 'ctc' ? (() => {
        const i = items.find((it: any) => it.id === qs.get('item'));
        if (!i) return <p>Resolution not found.</p>;
        const chair = data.people.find((p: any) => p.id === x.chairpersonId);
        const by = board ? 'BOARD OF DIRECTORS' : 'MEMBERS';
        const kind = i.resolutionType === 'SPECIAL' ? 'SPECIAL RESOLUTION' : i.resolutionType === 'ORDINARY' ? 'ORDINARY RESOLUTION' : 'RESOLUTION';
        return (
          <>
            <h3 style={{ textAlign: 'center' }}>CERTIFIED TRUE COPY OF THE {kind} PASSED BY THE {by} OF {client.name.toUpperCase()} AT {board ? 'THEIR' : 'THE'} {x.title.toUpperCase()} HELD ON {fmtDate(x.heldOn ?? x.date).toUpperCase()}{x.time ? ` AT ${x.time}` : ''} {x.mode === 'VIDEO' ? 'THROUGH VIDEO CONFERENCING' : `AT ${(x.venue ?? client.registeredOffice ?? '___').toUpperCase()}`}</h3>
            <p><strong>{i.title}</strong></p>
            <div style={{ whiteSpace: 'pre-wrap' }}>{i.text}</div>
            <p style={{ marginTop: 40 }}>Certified to be true<br />For {client.name}</p>
            <p style={{ marginTop: 50 }}>________________________<br />{chair ? chair.name : 'Name: ___'}<br />Director / Company Secretary<br />DIN / Membership No.: ___<br />Date: ___  ·  Place: ___</p>
            <p className="no-print muted small">Certify only after the minutes are signed{x.minutesSignedOn ? ` (signed ${fmtDate(x.minutesSignedOn)})` : ' — not signed yet'}.</p>
          </>
        );
      })() : doc === 'minutes' ? (
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 15 }}>{x.minutes || 'Minutes not written yet.'}</pre>
      ) : (
        <>
          <h3 style={{ textAlign: 'center' }}>NOTICE OF THE {x.title.toUpperCase()}</h3>
          <p>{board ? 'Notice is hereby given to the directors' : 'NOTICE is hereby given'} that the {x.title} of {client.name} will be held on <strong>{fmtDate(x.date)}</strong>{x.time && <> at <strong>{x.time}</strong></>} {where} to transact the following business:</p>
          <ol>{items.map((i: any) => (
            <li key={i.id} style={{ marginBottom: 10 }}>
              <strong>{i.title}</strong>
              {!board && i.resolutionType !== 'NONE' && <div style={{ fontSize: 14 }}>To consider and, if thought fit, to pass the following resolution as an {i.resolutionType === 'SPECIAL' ? 'special' : 'ordinary'} resolution:<div style={{ fontStyle: 'italic', marginTop: 4, whiteSpace: 'pre-wrap' }}>{i.text}</div></div>}
            </li>
          ))}</ol>
          {x.mode !== 'PHYSICAL' && x.videoLink && <p>Video conference link: {x.videoLink}</p>}
          {!board && items.some((i: any) => i.explanatory) && (
            <>
              <h4 style={{ marginTop: 28 }}>EXPLANATORY STATEMENT PURSUANT TO SECTION 102 OF THE COMPANIES ACT, 2013</h4>
              {items.map((i: any, n: number) => i.explanatory && <div key={i.id} style={{ marginBottom: 14 }}><strong>Item No. {n + 1}: {i.title}</strong><div style={{ whiteSpace: 'pre-wrap' }}>{i.explanatory}</div></div>)}
            </>
          )}
          {!board && <p style={{ fontSize: 13 }}>A member entitled to attend and vote is entitled to appoint a proxy to attend and vote instead of himself or herself, and the proxy need not be a member. Proxies must reach the registered office at least 48 hours before the meeting.</p>}
          <p style={{ marginTop: 40 }}>By order of the Board<br />For {client.name}</p>
          <p style={{ marginTop: 40 }}>________________________<br />Director / Company Secretary<br />Date: {fmtDate(x.noticeSentOn)}  ·  Place: ___</p>
          <p className="no-print muted small">{MODE[x.mode]} · Draft wording — check before sending.</p>
        </>
      )}
    </div>
  );
}
