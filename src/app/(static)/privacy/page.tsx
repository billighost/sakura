import { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy — Sakura",
  description: "Privacy policy for Sakura music app.",
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Privacy Policy</h1>
      <p className={styles.lastUpdated}>Last updated: August 5, 2026</p>

      <nav className={styles.toc}>
        <p className={styles.tocTitle}>Table of Contents</p>
        <ol className={styles.tocList}>
          <li><a href="#information-collected">Information We Collect</a></li>
          <li><a href="#data-usage">How We Use Your Data</a></li>
          <li><a href="#data-storage">Data Storage and Security</a></li>
          <li><a href="#data-retention">Data Retention</a></li>
          <li><a href="#cookies">Cookies and Local Storage</a></li>
          <li><a href="#third-party">Third-Party Services</a></li>
          <li><a href="#user-rights">Your Rights</a></li>
          <li><a href="#children">Children&apos;s Privacy</a></li>
          <li><a href="#changes">Changes to This Policy</a></li>
          <li><a href="#breach">Data Breach Notification</a></li>
          <li><a href="#contact">Contact Us</a></li>
        </ol>
      </nav>

      <section id="information-collected" className={styles.section}>
        <h2 className={styles.heading}>1. Information We Collect</h2>
        <p className={styles.text}>
          Sakura is a personal, single-user music library application. We collect only the
          information necessary to provide and improve the service.
        </p>
        <p className={styles.text}><strong>Account Information:</strong> When you create an
          account, we collect your username, email address, and a securely hashed version of
          your password. This data is required for authentication and account management.
        </p>
        <p className={styles.text}><strong>Library Data:</strong> Your music library metadata
          — including tracks, albums, artists, playlists, and listening history — is stored
          to power the application&apos;s core functionality.
        </p>
        <p className={styles.text}><strong>Profile Information:</strong> If you choose to
          provide a display name or avatar, this information is stored and displayed within
          the application.
        </p>
        <p className={styles.text}><strong>Usage Data:</strong> Sakura does not collect
          analytics, telemetry, or behavioral data. No browsing patterns, device information,
          or interaction metrics are tracked.
        </p>
      </section>

      <section id="data-usage" className={styles.section}>
        <h2 className={styles.heading}>2. How We Use Your Data</h2>
        <p className={styles.text}>
          Your data is used exclusively to operate and maintain the Sakura service. We do not
          sell, rent, license, or share your personal information with third parties for
          marketing or advertising purposes. Specifically, your data is used to:
        </p>
        <ul className={styles.list}>
          <li>Authenticate your sessions and manage your account</li>
          <li>Store and serve your music library</li>
          <li>Process audio files you import via Telegram</li>
          <li>Enable playlist creation and management</li>
          <li>Provide offline caching capabilities</li>
        </ul>
      </section>

      <section id="data-storage" className={styles.section}>
        <h2 className={styles.heading}>3. Data Storage and Security</h2>
        <p className={styles.text}>
          All application data is stored in a PostgreSQL database hosted on Neon, a managed
          database platform with built-in encryption at rest. Audio files are stored on
          Cloudinary&apos;s cloud infrastructure, which provides encrypted storage and
          delivery via HTTPS.
        </p>
        <p className={styles.text}>
          Passwords are hashed using bcrypt with a work factor appropriate for modern
          hardware. Authentication sessions are managed by NextAuth.js and are transmitted
          over encrypted HTTPS connections. No plaintext passwords are ever stored.
        </p>
        <p className={styles.text}>
          We implement reasonable administrative, technical, and physical safeguards to
          protect your data against unauthorized access, alteration, disclosure, or
          destruction. However, no method of electronic transmission or storage is completely
          secure, and we cannot guarantee absolute security.
        </p>
      </section>

      <section id="data-retention" className={styles.section}>
        <h2 className={styles.heading}>4. Data Retention</h2>
        <p className={styles.text}>
          Your account data and music library are retained for as long as your account
          remains active. If you choose to delete your account, all associated data —
          including your library, playlists, listening history, and account credentials —
          will be permanently removed from our servers within 30 days.
        </p>
        <p className={styles.text}>
          Audio files uploaded to Cloudinary may persist in CDN cache beyond this period.
          Upon account deletion, we will make reasonable efforts to purge cached copies, but
          CDN edge caching is managed by a third-party provider.
        </p>
        <p className={styles.text}>
          Database backups are retained for up to 7 days for disaster recovery purposes.
          Deleted account data will not be restored from backups after the 30-day window.
        </p>
      </section>

      <section id="cookies" className={styles.section}>
        <h2 className={styles.heading}>5. Cookies and Local Storage</h2>
        <p className={styles.text}>
          Sakura uses only the cookies strictly necessary for the application to function.
          These include:
        </p>
        <ul className={styles.list}>
          <li><strong>Session Cookies:</strong> Required for authentication. These are
            http-only, secure, and expire when you log out or your session times out.</li>
          <li><strong>CSRF Tokens:</strong> Used to protect against cross-site request
            forgery attacks.</li>
        </ul>
        <p className={styles.text}>
          Sakura does not use analytics cookies, advertising cookies, or any third-party
          tracking cookies. We do not use cookies for behavioral profiling.
        </p>
        <p className={styles.text}>
          When offline caching is enabled, audio files and library metadata may be stored
          locally in your browser&apos;s IndexedDB and Cache Storage. This data never
          leaves your device and can be cleared at any time from the Settings page or
          through your browser&apos;s storage management.
        </p>
      </section>

      <section id="third-party" className={styles.section}>
        <h2 className={styles.heading}>6. Third-Party Services</h2>
        <p className={styles.text}>
          Sakura integrates with the following third-party services to provide
          functionality:
        </p>
        <ul className={styles.list}>
          <li><strong>Cloudinary:</strong> Audio file storage and CDN delivery.
            Governed by Cloudinary&apos;s privacy policy.</li>
          <li><strong>Neon:</strong> PostgreSQL database hosting. Governed by
            Neon&apos;s privacy policy.</li>
          <li><strong>Upstash:</strong> Redis caching. Governed by Upstash&apos;s
            privacy policy.</li>
          <li><strong>Telegram Bot API:</strong> Music file import. Governed by
            Telegram&apos;s privacy policy.</li>
        </ul>
        <p className={styles.text}>
          These services receive only the minimum data required to perform their functions.
          We do not authorize them to use your data for any other purpose. We encourage you
          to review the privacy policies of these providers.
        </p>
      </section>

      <section id="user-rights" className={styles.section}>
        <h2 className={styles.heading}>7. Your Rights</h2>
        <p className={styles.text}>
          You have the following rights regarding your personal data:
        </p>
        <ul className={styles.list}>
          <li><strong>Right to Access:</strong> You may request a copy of all personal data
            we hold about you. This can be done through the Settings page or by contacting
            us directly.</li>
          <li><strong>Right to Rectification:</strong> You may update or correct inaccurate
            personal information at any time through your account settings.</li>
          <li><strong>Right to Deletion:</strong> You may request the permanent deletion of
            your account and all associated data. This action is irreversible and will be
            processed within 30 days.</li>
          <li><strong>Right to Data Portability:</strong> You may export your music library
            metadata and playlists in a structured, machine-readable format.</li>
          <li><strong>Right to Restrict Processing:</strong> You may request that we limit
            how we process your data, though this may affect the functionality of the
            service.</li>
        </ul>
        <p className={styles.text}>
          To exercise any of these rights, contact us at{" "}
          <strong>sakura@example.com</strong>.
        </p>
      </section>

      <section id="children" className={styles.section}>
        <h2 className={styles.heading}>8. Children&apos;s Privacy</h2>
        <p className={styles.text}>
          Sakura is not intended for use by individuals under the age of 13 (or the
          applicable age of digital consent in your jurisdiction). We do not knowingly
          collect personal information from children. If we become aware that we have
          collected data from a child, we will take steps to delete it promptly.
        </p>
      </section>

      <section id="changes" className={styles.section}>
        <h2 className={styles.heading}>9. Changes to This Policy</h2>
        <p className={styles.text}>
          We may update this Privacy Policy from time to time to reflect changes in our
          practices or applicable laws. When we make material changes, we will update the
          &quot;Last updated&quot; date at the top of this page. Your continued use of Sakura
          after changes are posted constitutes your acceptance of the updated policy.
        </p>
      </section>

      <section id="breach" className={styles.section}>
        <h2 className={styles.heading}>10. Data Breach Notification</h2>
        <p className={styles.text}>
          In the unlikely event of a data breach that affects your personal information, we
          will take the following steps:
        </p>
        <ul className={styles.list}>
          <li>Contain the breach and secure affected systems immediately</li>
          <li>Assess the scope and impact of the breach</li>
          <li>Notify affected users within 72 hours of discovery</li>
          <li>Provide details of the breach, affected data types, and remediation steps</li>
          <li>Report the breach to relevant supervisory authorities as required by
            applicable law</li>
        </ul>
        <p className={styles.text}>
          Given that Sakura is a single-user application with minimal data collection, the
          risk surface for breaches is significantly reduced.
        </p>
      </section>

      <section id="contact" className={styles.section}>
        <h2 className={styles.heading}>11. Contact Us</h2>
        <p className={styles.text}>
          If you have questions about this Privacy Policy, wish to exercise your data
          rights, or need to report a concern, please contact us at:
        </p>
        <p className={styles.text}>
          <strong>Email:</strong>{" "}
          <a href="mailto:sakura@example.com" className={styles.link}>
            sakura@example.com
          </a>
        </p>
      </section>
    </div>
  );
}
