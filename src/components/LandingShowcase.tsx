import { ArrowRight, Check, Eye, Github, Link, LoaderCircle, Pin, ShieldCheck } from 'lucide-react';
import type { TranslationKey } from '../i18n';

export default function LandingShowcase({ t, onDemo, onShare, sharing, shared }: { t: Record<TranslationKey, string>; onDemo: () => void; onShare: () => void; sharing: boolean; shared: boolean }) {
  return <section className="landing-showcase" aria-labelledby="showcase-title">
    <div className="showcase-copy">
      <span className="showcase-eyebrow"><span />{t.demoBadge}</span>
      <h2 id="showcase-title">{t.showcaseTitle}</h2>
      <p>{t.showcaseDescription}</p>
      <div className="showcase-features">
        <span><ShieldCheck size={14} />{t.privacy}</span>
        <span><Eye size={14} />{t.reviewChanges}</span>
        <span><Pin size={14} />{t.handoff}</span>
      </div>
      <div className="showcase-actions"><button className="button primary" onClick={onDemo}>{t.showcaseAction}<ArrowRight size={15} /></button><a href="https://github.com/hajimi1214/ThreadPack" target="_blank" rel="noopener noreferrer"><Github size={15} />GitHub<ArrowRight size={12} /></a><button className="share-project" disabled={sharing} aria-label={t.shareProject} aria-busy={sharing} title={t.shareProjectHint} onClick={onShare}>{sharing ? <LoaderCircle size={14} className="spin" /> : shared ? <Check size={14} /> : <Link size={14} />}{shared ? t.copied : t.shareProject}</button></div>
    </div>
    <div className="showcase-example">
      <div className="showcase-code source"><div className="showcase-code-heading"><span><i /><i /><i /></span><strong>{t.original}</strong><span className="showcase-file">conversation.jsonl</span></div><pre><span className="sample-muted">API_KEY=</span><span className="sample-secret">"demo_value_for_documentation_only_12345678"</span>{'\n'}<span className="sample-muted">CONTACT=</span>developer@example.test</pre></div>
      <div className="showcase-code packed"><div className="showcase-code-heading"><span className="showcase-check"><Check size={12} /></span><strong>{t.cleaned}</strong><span className="showcase-file">threadpack-transcript.md</span></div><pre><span className="sample-muted">API_KEY=</span><span className="sample-alias">"[SECRET_1]"</span>{'\n'}<span className="sample-muted">CONTACT=</span>developer@example.test</pre></div>
      <p className="showcase-kept"><Check size={13} />{t.showcaseKept}</p>
    </div>
  </section>;
}
