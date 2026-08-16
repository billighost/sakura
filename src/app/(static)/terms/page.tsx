import { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Terms — Sakura",
  description: "The rules for using Sakura, in plain English.",
};

/**
 * Terms of use.
 *
 * Deliberately not a template. The previous version was a fourteen-section
 * boilerplate that described a licensed streaming service with an intellectual
 * property position it does not have — which is worse than no terms, because it
 * asserts things that are untrue.
 *
 * The substantive change is the content-source section: Sakura locates audio in
 * public Telegram channels and caches it, and it licenses nothing. A terms page
 * cannot fix that, and pretending the service holds rights it doesn't hold would
 * make this document actively misleading. It says what is true and flags the
 * question for a lawyer.
 *
 * See the same flag in ../privacy/page.tsx. Between them, the unreviewed items
 * are: the operator's legal identity, governing law and forum, the enforceability
 * of the liability limits, and the entire content-source position.
 */
export default function TermsPage() {
  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>Terms</h1>
        <p className={styles.lastUpdated}>Last updated: 16 August 2026</p>
      </div>

      <section className={styles.summary} aria-label="Summary">
        <h2 className={styles.summaryTitle}>The short version</h2>
        <ul className={styles.summaryList}>
          <li>
            Sakura is a free personal project. It comes with no guarantees and it
            might break or disappear.
          </li>
          <li>
            It doesn&apos;t licence the music it plays. Recordings are found in
            public Telegram channels, and rights to them belong to whoever made
            them.
          </li>
          <li>
            Your account, your playlists and your responsibility: keep your
            password to yourself, and don&apos;t use Sakura to do anything
            illegal.
          </li>
          <li>
            We can suspend an account that&apos;s being used to abuse the service,
            and you can stop using it whenever you like.
          </li>
        </ul>
      </section>

      <nav className={styles.toc} aria-label="Table of contents">
        <p className={styles.tocTitle}>Contents</p>
        <ul className={styles.tocList}>
          <li><a href="#what">What Sakura is</a></li>
          <li><a href="#agreeing">Agreeing to these terms</a></li>
          <li><a href="#account">Your account</a></li>
          <li><a href="#music">The music</a></li>
          <li><a href="#use">What you can and can&apos;t do</a></li>
          <li><a href="#yours">Things you make</a></li>
          <li><a href="#ours">Sakura itself</a></li>
          <li><a href="#nogurantee">No guarantees</a></li>
          <li><a href="#liability">Limits on liability</a></li>
          <li><a href="#ending">Ending it</a></li>
          <li><a href="#law">Which law applies</a></li>
          <li><a href="#changes">Changes to these terms</a></li>
          <li><a href="#contact">Getting in touch</a></li>
        </ul>
      </nav>

      <div className={styles.content}>
        <section id="what" className={styles.section}>
          <h2 className={styles.heading}>What Sakura is</h2>
          <p className={styles.text}>
            Sakura is a music player, run as a personal project by one person, at
            no charge. It finds recordings, plays them, lets you save them to your
            phone so they work without a signal, and builds mixes from what you
            listen to.
          </p>
          <p className={styles.text}>
            It is not a company, it has no employees, and it earns nothing. Read
            the rest of this page with that in mind — most of it follows from it.
          </p>
        </section>

        <section id="agreeing" className={styles.section}>
          <h2 className={styles.heading}>Agreeing to these terms</h2>
          <p className={styles.text}>
            Making an account means you accept what&apos;s on this page. If you
            don&apos;t, don&apos;t make one — and if you already have one, you can
            stop using it at any time.
          </p>
          <p className={styles.text}>
            You need to be old enough to agree to terms where you live, and at
            least 13.
          </p>
        </section>

        <section id="account" className={styles.section}>
          <h2 className={styles.heading}>Your account</h2>
          <p className={styles.text}>
            Keep your password to yourself. Anything done through your account is
            treated as done by you, so tell us if you think someone else has got
            in.
          </p>
          <p className={styles.text}>
            One account per person. Don&apos;t impersonate anyone, and don&apos;t
            pick a username designed to make people think you&apos;re someone
            else.
          </p>
          <p className={styles.text}>
            Please don&apos;t reuse an important password here. See{" "}
            <Link href="/privacy" className={styles.link}>
              Privacy
            </Link>{" "}
            for why.
          </p>
        </section>

        <section id="music" className={styles.section}>
          <h2 className={styles.heading}>The music</h2>
          <p className={styles.text}>
            This is the part that matters most, so it&apos;s said plainly rather
            than buried.
          </p>
          <p className={styles.text}>
            <strong>Sakura does not licence any of the music it plays.</strong>{" "}
            Song and artist information comes from Deezer&apos;s public API. The
            recordings themselves are located by searching public Telegram
            channels, and a copy is cached so it plays quickly next time. Lyrics
            come from third-party lyric services.
          </p>
          <p className={styles.text}>
            Everything Sakura plays belongs to the people who wrote, performed and
            released it. Nothing on this page transfers any right in it to you or
            to us. Playing a recording here is not a licence to copy it, upload it,
            perform it, or use it in anything you make.
          </p>
          <div className={styles.callout}>
            <p>
              <strong>If you hold rights in something Sakura is playing</strong>{" "}
              and you want it removed, email the address at the bottom of this page
              with enough detail to identify the recording. It will be removed from
              the cache and blocked from being re-fetched.
            </p>
            <p>
              <strong>Needs legal review, urgently:</strong> the arrangement
              described above is the project&apos;s largest legal exposure. It is a
              question about whether the service can lawfully operate as built, not
              a drafting problem — no wording on this page resolves it, and a
              notice-and-takedown process is not on its own a defence.
            </p>
          </div>
        </section>

        <section id="use" className={styles.section}>
          <h2 className={styles.heading}>What you can and can&apos;t do</h2>
          <p className={styles.text}>Use Sakura to listen to music. Please don&apos;t:</p>
          <ul className={styles.list}>
            <li>
              Redistribute what you download — the offline copies are for your own
              listening, on your own devices.
            </li>
            <li>
              Break into anything: other people&apos;s accounts, the database, the
              servers, or parts of the app you weren&apos;t given access to.
            </li>
            <li>
              Hammer it. Automated scraping, bulk downloading, or anything that
              makes the service worse for everyone else.
            </li>
            <li>
              Get around rate limits, or work around a suspension by making
              another account.
            </li>
            <li>
              Put anything illegal, hateful, or designed to harass someone into a
              playlist name, description or share.
            </li>
            <li>Use Sakura to build a competing service, or resell access to it.</li>
          </ul>
        </section>

        <section id="yours" className={styles.section}>
          <h2 className={styles.heading}>Things you make</h2>
          <p className={styles.text}>
            Your playlists, their names and descriptions, your profile and the
            share cards you create are yours. You keep them.
          </p>
          <p className={styles.text}>
            By making a playlist public, or by creating a share link, you&apos;re
            asking us to show it to whoever has the link — so you&apos;re giving us
            permission to store and display it for that purpose. That permission
            ends when you make it private again or delete it.
          </p>
          <p className={styles.text}>
            You&apos;re responsible for what you put in them. We can remove
            anything that breaks the rules above.
          </p>
        </section>

        <section id="ours" className={styles.section}>
          <h2 className={styles.heading}>Sakura itself</h2>
          <p className={styles.text}>
            The app — its code, its design, its name and its blossom mark — belongs
            to the project. Using Sakura doesn&apos;t give you any right to copy or
            reuse those.
          </p>
          <p className={styles.text}>
            This is separate from the music, which belongs to other people
            entirely. See above.
          </p>
        </section>

        <section id="nogurantee" className={styles.section}>
          <h2 className={styles.heading}>No guarantees</h2>
          <p className={styles.text}>
            Sakura is provided as it is. There&apos;s no promise that it will work,
            that a particular song will be findable, that your downloads will
            survive, or that the service will exist next month.
          </p>
          <p className={styles.text}>
            In particular: <strong>keep your own copies of anything you care
            about</strong>. Downloads live in your browser&apos;s storage, which
            your phone can clear on its own when space runs low. The export in
            Settings gives you your playlists and history as a file — use it.
          </p>
        </section>

        <section id="liability" className={styles.section}>
          <h2 className={styles.heading}>Limits on liability</h2>
          <p className={styles.text}>
            To the extent the law allows, the project and the person running it
            aren&apos;t liable for anything you lose by using Sakura — data,
            downloads, time, or anything that follows from the service being
            unavailable or wrong.
          </p>
          <p className={styles.text}>
            Nothing here tries to exclude liability that can&apos;t legally be
            excluded, and where you have rights as a consumer, this page doesn&apos;t
            take them away.
          </p>
          <div className={styles.callout}>
            <p>
              <strong>Needs legal review:</strong> how much of this limitation is
              enforceable depends entirely on jurisdiction, and for a free service
              with no company behind it the answer may be very little. The clause is
              written to be honest about intent rather than to be maximally broad.
            </p>
          </div>
        </section>

        <section id="ending" className={styles.section}>
          <h2 className={styles.heading}>Ending it</h2>
          <p className={styles.text}>
            You can stop using Sakura at any time. To have your account and
            everything in it deleted, email us — the app can&apos;t do it on its own
            yet, which is explained in{" "}
            <Link href="/privacy" className={styles.link}>
              Privacy
            </Link>
            .
          </p>
          <p className={styles.text}>
            We may suspend or remove an account that&apos;s being used to break the
            rules above, or where keeping it would put the project at risk.
            Where it&apos;s reasonable to do so we&apos;ll say why first.
          </p>
          <p className={styles.text}>
            The whole service may also stop. If it&apos;s a decision rather than a
            failure, we&apos;ll give notice in the app so you can export your data
            first.
          </p>
        </section>

        <section id="law" className={styles.section}>
          <h2 className={styles.heading}>Which law applies</h2>
          <div className={styles.callout}>
            <p>
              <strong>Not decided.</strong> This page deliberately does not name a
              governing law or a court, because the operator&apos;s country of
              establishment hasn&apos;t been settled and choosing one at random
              would be worse than leaving it open.
            </p>
            <p>
              <strong>Needs legal review:</strong> governing law and forum, plus
              whether a consumer in the UK or EU can be bound by them at all.
            </p>
          </div>
        </section>

        <section id="changes" className={styles.section}>
          <h2 className={styles.heading}>Changes to these terms</h2>
          <p className={styles.text}>
            These can change. If a change affects what you&apos;re allowed to do or
            what you&apos;re agreeing to, we&apos;ll say so in the app rather than
            silently updating the date at the top. Carrying on using Sakura after
            that means you accept the new version.
          </p>
        </section>

        <section id="contact" className={styles.section}>
          <h2 className={styles.heading}>Getting in touch</h2>
          <p className={styles.text}>
            For anything on this page, including a rights complaint, email{" "}
            <a href="mailto:hello@sakura.app" className={styles.link}>
              hello@sakura.app
            </a>
            . One person reads it, so allow a few days.
          </p>
          <div className={styles.callout}>
            <p>
              <strong>Needs legal review:</strong> the address above is a
              placeholder and needs to be a real, monitored inbox before this page
              is published.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
