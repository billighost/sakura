import { Metadata } from "next";
import Link from "next/link";
import styles from "../legal.module.css";

export const metadata: Metadata = {
  title: "Privacy — Sakura",
  description: "What Sakura collects, why, and what you can do about it.",
};

/**
 * Privacy policy.
 *
 * Written against the code rather than from a template. Every claim here was
 * checked against `prisma/schema.prisma`, `src/lib/offline-db.ts`,
 * `src/app/api/export/route.ts` and the outbound hosts in `src/lib`.
 *
 * ── Two things this page says that a template wouldn't ────────────────────
 *
 * 1. There is no self-service account deletion. There is no DELETE handler on
 *    /api/profile and no `user.delete` call anywhere in the codebase. Claiming a
 *    deletion right the product cannot honour would be worse than saying so, so
 *    it says so, in a callout, with the manual route.
 * 2. Where the audio comes from. It is fetched from Telegram channels by a bot
 *    and cached to Cloudinary; the metadata comes from Deezer. That is a
 *    material fact about what a listener is participating in and it is stated
 *    plainly.
 *
 * ── Where a lawyer needs to look ──────────────────────────────────────────
 *
 * Flagged in the page itself as well, but for whoever edits this file: the
 * controller identity, the legal basis claims, the governing law, the retention
 * periods for anything other than ListeningHistory, and the whole of the
 * content-source position are unreviewed. The last of those is not a drafting
 * problem — it's a question about whether the service can operate as built.
 */

/* Sourced from HISTORY_RAW_DAYS in src/lib/historyRetention.ts. */
const RAW_HISTORY_DAYS = 60;

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>Privacy</h1>
        <p className={styles.lastUpdated}>Last updated: 16 August 2026</p>
      </div>

      <section className={styles.summary} aria-label="Summary">
        <h2 className={styles.summaryTitle}>The short version</h2>
        <ul className={styles.summaryList}>
          <li>
            We keep your account details and a record of what you listen to. The
            listening record is what builds your mixes — it isn&apos;t used for
            anything else.
          </li>
          <li>
            We don&apos;t run ads, we don&apos;t sell your data, and there are no
            analytics or tracking scripts in the app.
          </li>
          <li>
            Music you save for offline stays on your device. We can&apos;t see it
            and it never leaves your phone.
          </li>
          <li>
            You can download everything we hold about you at any time. Deleting
            your account currently needs an email to us — see below.
          </li>
        </ul>
      </section>

      <nav className={styles.toc} aria-label="Table of contents">
        <p className={styles.tocTitle}>Contents</p>
        <ul className={styles.tocList}>
          <li><a href="#who">Who runs Sakura</a></li>
          <li><a href="#what">What we collect</a></li>
          <li><a href="#why">Why we collect it</a></li>
          <li><a href="#music">Where the music comes from</a></li>
          <li><a href="#others">Other companies involved</a></li>
          <li><a href="#device">What&apos;s stored on your device</a></li>
          <li><a href="#keep">How long we keep it</a></li>
          <li><a href="#rights">Your choices</a></li>
          <li><a href="#security">Keeping it safe</a></li>
          <li><a href="#children">Children</a></li>
          <li><a href="#changes">Changes to this page</a></li>
          <li><a href="#contact">Getting in touch</a></li>
        </ul>
      </nav>

      <div className={styles.content}>
        <section id="who" className={styles.section}>
          <h2 className={styles.heading}>Who runs Sakura</h2>
          <p className={styles.text}>
            Sakura is an independent project, not a company. It is run by one
            person and it makes no money. That matters for two reasons: there is
            no advertising business behind it that would benefit from knowing more
            about you, and there is also no support team — questions come to one
            inbox.
          </p>
          <div className={styles.callout}>
            <p>
              <strong>Needs legal review:</strong> the operator&apos;s legal
              identity and country of establishment are not stated here because
              they haven&apos;t been decided. Both are required in most places
              before this page counts as a privacy notice.
            </p>
          </div>
        </section>

        <section id="what" className={styles.section}>
          <h2 className={styles.heading}>What we collect</h2>
          <p className={styles.text}>
            Everything below is either something you typed in or something the app
            recorded because you pressed play. There is no third party watching
            you inside Sakura: no analytics, no advertising pixels, no session
            recording.
          </p>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">What</th>
                  <th scope="col">Details</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Your account</td>
                  <td>
                    Username, email address, and your password stored as a
                    one-way hash we cannot reverse. Optionally a profile picture
                    and a short bio if you add them.
                  </td>
                </tr>
                <tr>
                  <td>What you play</td>
                  <td>
                    For each play: the song, when it happened, how many seconds
                    you actually heard, whether you finished it or skipped and how
                    far in, where you started it from (a mix, a playlist, search),
                    whether the app queued it rather than you, and the hour and
                    day of the week.
                  </td>
                </tr>
                <tr>
                  <td>Your taste profile</td>
                  <td>
                    Scores per artist and per genre, worked out from the above;
                    the genres and artists you picked when you signed up; how
                    adventurous you asked your mixes to be; and summary figures
                    like your skip rate and the era of music you lean toward.
                  </td>
                </tr>
                <tr>
                  <td>Your library</td>
                  <td>
                    Playlists and their contents, liked songs, songs you told us
                    to stop playing, and the mixes we&apos;ve built for you.
                  </td>
                </tr>
                <tr>
                  <td>Where you got to</td>
                  <td>
                    The current song, position and queue, so playback picks up on
                    your other devices.
                  </td>
                </tr>
                <tr>
                  <td>Things you share</td>
                  <td>
                    When you create a share link we store the link&apos;s public
                    address, what it points at, any lyrics you selected, and a
                    count of how many times it&apos;s been opened.
                  </td>
                </tr>
                <tr>
                  <td>Spotify, if you connect it</td>
                  <td>
                    An access token for your Spotify account, used only to list
                    and read the playlists you choose to import. It is not used
                    to read anything else and we do not store your Spotify
                    listening history.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <p className={styles.text}>
            We do not collect your location, your contacts, your device
            identifiers for advertising, or anything from other apps.
          </p>
        </section>

        <section id="why" className={styles.section}>
          <h2 className={styles.heading}>Why we collect it</h2>
          <p className={styles.text}>
            Your account details exist so you can sign in and so your library
            follows you between devices. Your listening record exists to build
            your mixes and to decide what plays when a queue runs out — that is
            its only purpose, and it is the reason the record is as detailed as it
            is. A bare list of songs played cannot tell a song you loved from one
            you killed after two seconds.
          </p>
          <p className={styles.text}>
            Nothing is used for advertising. Nothing is sold. Nothing is shared
            with anyone for their own purposes.
          </p>
          <div className={styles.callout}>
            <p>
              <strong>Needs legal review:</strong> if Sakura has users in the UK
              or the EU, each of the categories above needs a stated lawful basis
              under the GDPR — most likely contract for the account and library,
              and legitimate interests or consent for the listening record. That
              determination hasn&apos;t been made, so this page describes purposes
              honestly but does not claim a basis it can&apos;t defend.
            </p>
          </div>
        </section>

        <section id="music" className={styles.section}>
          <h2 className={styles.heading}>Where the music comes from</h2>
          <p className={styles.text}>
            This belongs in a privacy page because it changes who else is involved
            when you press play, and because you should know what you are taking
            part in.
          </p>
          <p className={styles.text}>
            Sakura does not licence music. Song and album information — titles,
            artists, artwork, charts — comes from Deezer&apos;s public API. The
            audio itself is located by searching public Telegram channels through
            a Telegram bot, and a copy is then cached on Cloudinary so it plays
            quickly the next time. Lyrics come from LRCLIB and a lyrics service
            hosted on Hugging Face.
          </p>
          <div className={styles.callout}>
            <p>
              <strong>Be aware:</strong> that means the recordings Sakura plays
              are not licensed by us, and in most cases the people who made them
              are not being paid for these plays. If that isn&apos;t something
              you want to take part in, this is the point to stop using it.
            </p>
            <p>
              <strong>Needs legal review, urgently:</strong> this arrangement is
              the single largest legal exposure in the project, and it is a
              question about whether the service can lawfully operate as built —
              not something better wording can fix.
            </p>
          </div>
          <p className={styles.text}>
            Practically: when you search or play, a request carrying the song and
            artist you asked for goes to Deezer and to Telegram. Neither receives
            your account details, your email or your listening history.
          </p>
        </section>

        <section id="others" className={styles.section}>
          <h2 className={styles.heading}>Other companies involved</h2>
          <p className={styles.text}>
            Sakura runs on other people&apos;s infrastructure. These companies
            process data on our behalf and are not allowed to use it for their own
            purposes.
          </p>
          <ul className={styles.list}>
            <li>
              <strong>Vercel</strong> — runs the app and serves it to your
              browser. Sees your IP address and the requests you make, as any web
              host does.
            </li>
            <li>
              <strong>Neon</strong> — hosts the database, so it holds everything
              in the table above.
            </li>
            <li>
              <strong>Upstash</strong> — a short-lived cache and rate limiter.
              Holds recent search results and provider responses for minutes to
              hours.
            </li>
            <li>
              <strong>Cloudinary</strong> — stores cached audio files and profile
              pictures.
            </li>
          </ul>
          <p className={styles.text}>
            And these receive a query when you use the feature that needs them,
            but never your identity:{" "}
            <strong>Deezer</strong> (catalogue, charts, search),{" "}
            <strong>Telegram</strong> (audio), <strong>LRCLIB</strong> and a{" "}
            <strong>Hugging Face</strong>-hosted service (lyrics),{" "}
            <strong>MusicBrainz</strong> and <strong>Apple</strong> (extra
            metadata and chart data), and <strong>Spotify</strong> (only if you
            connect it, and only for importing).
          </p>
          <div className={styles.callout}>
            <p>
              <strong>Needs legal review:</strong> in the UK and the EU each of
              the four processors above requires a data processing agreement, and
              some of them store data outside the UK/EEA, which requires a
              transfer mechanism. Neither has been put in place.
            </p>
          </div>
        </section>

        <section id="device" className={styles.section}>
          <h2 className={styles.heading}>What&apos;s stored on your device</h2>
          <p className={styles.text}>
            Sakura is built to keep working with no signal, which means a lot of it
            lives on your phone rather than on our servers. In a browser database
            called <code className={styles.code}>sakura-offline</code> it keeps:
            the audio files you saved for offline, the song and playlist details
            that go with them, lyrics you&apos;ve viewed, and partly-finished
            downloads so an interrupted one can resume.
          </p>
          <p className={styles.text}>
            It also remembers small preferences — your theme, your sort order on
            each list, recent searches, recent imports — in your browser&apos;s
            local storage.
          </p>
          <p className={styles.text}>
            <strong>None of that is sent to us.</strong> We do not know what
            you&apos;ve downloaded. Clearing your browser&apos;s data for this
            site, or removing downloads from Settings, deletes all of it.
          </p>
          <p className={styles.text}>
            There are no advertising or analytics cookies. The only cookie Sakura
            sets is the one that keeps you signed in.
          </p>
        </section>

        <section id="keep" className={styles.section}>
          <h2 className={styles.heading}>How long we keep it</h2>
          <p className={styles.text}>
            Individual plays are kept in full for{" "}
            <strong>{RAW_HISTORY_DAYS} days</strong>. After that they are folded
            into a running total per song — how many times, how long, how strong a
            signal — and the individual rows are deleted. So your long-term taste
            survives but the minute-by-minute record of what you played on a
            particular evening last spring does not.
          </p>
          <p className={styles.text}>
            Everything else — your account, playlists, liked songs, taste profile
            — is kept until you ask us to delete it.
          </p>
          <div className={styles.callout}>
            <p>
              <strong>Needs legal review:</strong> {RAW_HISTORY_DAYS} days is
              taken from the code, and it exists for a storage reason rather than
              a privacy one. Whether it is also a defensible retention period, and
              what period should apply to everything else, hasn&apos;t been
              assessed.
            </p>
          </div>
        </section>

        <section id="rights" className={styles.section}>
          <h2 className={styles.heading}>Your choices</h2>

          <h3 className={styles.subheading}>Get a copy of your data</h3>
          <p className={styles.text}>
            Settings → Export gives you a file containing your profile, your
            playlists, your liked songs and your listening history. It arrives as
            JSON, which is a plain text format any tool can read. History is
            capped at the most recent 5,000 plays; ask us if you need more.
          </p>

          <h3 className={styles.subheading}>Correct something</h3>
          <p className={styles.text}>
            Your username, bio and picture are editable on your profile. For
            anything else, email us.
          </p>

          <h3 className={styles.subheading}>Delete your account</h3>
          <div className={styles.callout}>
            <p>
              <strong>There is no delete button yet.</strong> The app cannot
              currently delete an account on its own — that has to be done by
              hand. Email us from your account&apos;s address and we will remove
              the account and everything attached to it: your library, your
              history, your taste profile and any share links you made.
            </p>
            <p>
              We&apos;d rather admit this than list a right the app can&apos;t
              honour. Building it is on the list.
            </p>
          </div>

          <h3 className={styles.subheading}>Stop the taste tracking</h3>
          <p className={styles.text}>
            You can&apos;t currently turn off the listening record while still
            using the app — the mixes are built from it, and nothing else in
            Sakura would work without it. If that isn&apos;t acceptable to you,
            the honest answer is that Sakura isn&apos;t the right app for you.
          </p>
        </section>

        <section id="security" className={styles.section}>
          <h2 className={styles.heading}>Keeping it safe</h2>
          <p className={styles.text}>
            Passwords are stored as bcrypt hashes, so nobody — including us — can
            read them. Everything travels over HTTPS. Access to the database is
            limited to the app.
          </p>
          <p className={styles.text}>
            That said: this is a personal project run by one person, not a company
            with a security team. Please don&apos;t reuse a password here that
            protects anything you care about, and assume the same level of
            assurance you would give any small independent service.
          </p>
        </section>

        <section id="children" className={styles.section}>
          <h2 className={styles.heading}>Children</h2>
          <p className={styles.text}>
            Sakura isn&apos;t intended for children under 13, and we don&apos;t
            knowingly collect anything from them. We also don&apos;t ask your age,
            so we have no way to check. If you believe a child has an account,
            email us and we&apos;ll remove it.
          </p>
        </section>

        <section id="changes" className={styles.section}>
          <h2 className={styles.heading}>Changes to this page</h2>
          <p className={styles.text}>
            If this changes in a way that affects you, we&apos;ll say so in the app
            rather than quietly updating the date at the top. The date at the top
            tells you when it last changed at all.
          </p>
        </section>

        <section id="contact" className={styles.section}>
          <h2 className={styles.heading}>Getting in touch</h2>
          <p className={styles.text}>
            For anything on this page — a copy of your data, a correction, a
            deletion, or a question — email{" "}
            <a href="mailto:privacy@sakura.app" className={styles.link}>
              privacy@sakura.app
            </a>
            . One person reads it, so allow a few days.
          </p>
          <p className={styles.text}>
            Our <Link href="/terms" className={styles.link}>terms</Link> cover
            what you can and can&apos;t do with the app.
          </p>
          <div className={styles.callout}>
            <p>
              <strong>Needs legal review:</strong> the contact address above is a
              placeholder and needs to be a real, monitored inbox. Where required,
              a data protection contact and — if applicable — a representative in
              the UK or EU must also be named.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
