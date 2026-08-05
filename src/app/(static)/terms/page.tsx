import { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Terms of Service — Sakura",
  description: "Terms of service for Sakura music app.",
};

export default function TermsPage() {
  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Terms of Service</h1>
      <p className={styles.lastUpdated}>Last updated: August 5, 2026</p>

      <nav className={styles.toc}>
        <p className={styles.tocTitle}>Table of Contents</p>
        <ol className={styles.tocList}>
          <li><a href="#acceptance">Acceptance of Terms</a></li>
          <li><a href="#description">Description of Service</a></li>
          <li><a href="#eligibility">Eligibility</a></li>
          <li><a href="#account">Account Responsibilities</a></li>
          <li><a href="#acceptable-use">Acceptable Use Policy</a></li>
          <li><a href="#intellectual-property">Intellectual Property</a></li>
          <li><a href="#user-content">User Content</a></li>
          <li><a href="#disclaimer">Disclaimer of Warranties</a></li>
          <li><a href="#limitation">Limitation of Liability</a></li>
          <li><a href="#indemnification">Indemnification</a></li>
          <li><a href="#termination">Termination</a></li>
          <li><a href="#governing-law">Governing Law</a></li>
          <li><a href="#changes">Changes to Terms</a></li>
          <li><a href="#contact">Contact</a></li>
        </ol>
      </nav>

      <section id="acceptance" className={styles.section}>
        <h2 className={styles.heading}>1. Acceptance of Terms</h2>
        <p className={styles.text}>
          By accessing or using Sakura (&quot;the Service&quot;), you agree to be bound by
          these Terms of Service (&quot;Terms&quot;). If you do not agree to these Terms,
          you must not access or use the Service. These Terms constitute a legally binding
          agreement between you and the operator of Sakura.
        </p>
      </section>

      <section id="description" className={styles.section}>
        <h2 className={styles.heading}>2. Description of Service</h2>
        <p className={styles.text}>
          Sakura is a personal music library application that allows you to manage, organize,
          and stream audio files that you legally own. The Service provides library
          management, playlist creation, audio playback, and file import via Telegram bot
          integration. Sakura is a single-user application and does not provide music
          hosting, sharing, or distribution capabilities.
        </p>
      </section>

      <section id="eligibility" className={styles.section}>
        <h2 className={styles.heading}>3. Eligibility</h2>
        <p className={styles.text}>
          You must be at least 13 years of age (or the minimum age required in your
          jurisdiction) to use Sakura. By using the Service, you represent and warrant that
          you meet this age requirement and have the legal capacity to enter into these
          Terms.
        </p>
      </section>

      <section id="account" className={styles.section}>
        <h2 className={styles.heading}>4. Account Responsibilities</h2>
        <p className={styles.text}>
          You are responsible for maintaining the confidentiality of your account credentials
          and for all activity that occurs under your account. You agree to:
        </p>
        <ul className={styles.list}>
          <li>Provide accurate and complete registration information</li>
          <li>Maintain the security of your password and account</li>
          <li>Notify us immediately of any unauthorized use of your account</li>
          <li>Accept responsibility for all activities conducted through your account</li>
        </ul>
        <p className={styles.text}>
          Sakura reserves the right to suspend or terminate accounts that are found to be
          in violation of these Terms.
        </p>
      </section>

      <section id="acceptable-use" className={styles.section}>
        <h2 className={styles.heading}>5. Acceptable Use Policy</h2>
        <p className={styles.text}>
          You agree to use Sakura only for lawful purposes and in compliance with all
          applicable laws and regulations. You must not:
        </p>
        <ul className={styles.list}>
          <li>Upload, store, or distribute copyrighted music that you do not own or have
            the legal right to possess</li>
          <li>Use the Service to distribute, share, or make available copyrighted content
            to others</li>
          <li>Attempt to gain unauthorized access to any part of the Service, other accounts,
            or connected systems</li>
          <li>Interfere with or disrupt the Service, servers, or networks</li>
          <li>Use automated tools (bots, scrapers) to access the Service without written
            permission</li>
          <li>Reverse engineer, decompile, or disassemble any part of the Service</li>
          <li>Use the Service to transmit malware, viruses, or other harmful code</li>
          <li>Impersonate another person or misrepresent your affiliation with any entity</li>
        </ul>
        <p className={styles.text}>
          You are solely responsible for ensuring that your use of the Service complies with
          all applicable laws regarding music ownership and file handling in your
          jurisdiction.
        </p>
      </section>

      <section id="intellectual-property" className={styles.section}>
        <h2 className={styles.heading}>6. Intellectual Property</h2>
        <p className={styles.text}>
          All intellectual property rights in the Service — including its code, design, logo,
          and interface — are owned by the developer of Sakura. These Terms do not grant you
          any rights to use the Sakura name, logo, or branding without prior written
          consent.
        </p>
        <p className={styles.text}>
          The Service is provided as a personal tool for managing your own legally-owned
          content. Nothing in these Terms should be interpreted as granting any license or
          right to use copyrighted music through the Service beyond what you are legally
          entitled to possess.
        </p>
      </section>

      <section id="user-content" className={styles.section}>
        <h2 className={styles.heading}>7. User Content</h2>
        <p className={styles.text}>
          You retain full ownership of all audio files and content you upload to or process
          through Sakura. Sakura does not claim any ownership over your content. By using
          the Service, you grant Sakura a limited, non-exclusive license to process,
          store, and stream your content solely for the purpose of providing the Service to
          you.
        </p>
        <p className={styles.text}>
          You are responsible for ensuring that all content you upload is legally owned by
          you or that you have the necessary rights to store and stream it. Sakura
          disclaims any responsibility for the legality of content stored by users.
        </p>
      </section>

      <section id="disclaimer" className={styles.section}>
        <h2 className={styles.heading}>8. Disclaimer of Warranties</h2>
        <p className={styles.text}>
          The Service is provided on an &quot;as is&quot; and &quot;as available&quot; basis
          without warranties of any kind, whether express, implied, or statutory. We do not
          warrant that:
        </p>
        <ul className={styles.list}>
          <li>The Service will be uninterrupted, timely, secure, or error-free</li>
          <li>The results obtained from the Service will be accurate or reliable</li>
          <li>The quality of the Service will meet your expectations</li>
          <li>Any errors in the Service will be corrected</li>
        </ul>
        <p className={styles.text}>
          To the fullest extent permitted by law, we disclaim all warranties, including but
          not limited to implied warranties of merchantability, fitness for a particular
          purpose, and non-infringement.
        </p>
      </section>

      <section id="limitation" className={styles.section}>
        <h2 className={styles.heading}>9. Limitation of Liability</h2>
        <p className={styles.text}>
          To the maximum extent permitted by applicable law, the developer of Sakura shall
          not be liable for any indirect, incidental, special, consequential, or punitive
          damages, including but not limited to loss of profits, data, use, or goodwill,
          arising out of or related to your use of the Service, regardless of the theory of
          liability.
        </p>
        <p className={styles.text}>
          In no event shall our total aggregate liability exceed the amount you paid to us
          for the Service in the twelve (12) months preceding the claim, or one hundred
          dollars ($100), whichever is greater.
        </p>
      </section>

      <section id="indemnification" className={styles.section}>
        <h2 className={styles.heading}>10. Indemnification</h2>
        <p className={styles.text}>
          You agree to indemnify, defend, and hold harmless the developer of Sakura, its
          affiliates, officers, directors, employees, and agents from and against any and
          all claims, liabilities, damages, losses, costs, and expenses (including
          reasonable attorneys&apos; fees) arising out of or in any way connected with:
        </p>
        <ul className={styles.list}>
          <li>Your access to or use of the Service</li>
          <li>Your violation of these Terms</li>
          <li>Your violation of any applicable law or regulation</li>
          <li>Any content you upload, store, or distribute through the Service</li>
          <li>Your infringement or misappropriation of any third-party rights</li>
        </ul>
      </section>

      <section id="termination" className={styles.section}>
        <h2 className={styles.heading}>11. Termination</h2>
        <p className={styles.text}>
          We reserve the right to suspend or terminate your access to the Service at our
          sole discretion, without notice, for conduct that we believe violates these Terms
          or is harmful to other users, the Service, or third parties.
        </p>
        <p className={styles.text}>
          You may terminate your account at any time by using the account deletion feature
          in Settings or by contacting us directly. Upon termination:
        </p>
        <ul className={styles.list}>
          <li>Your right to access the Service immediately ceases</li>
          <li>All data associated with your account will be deleted within 30 days</li>
          <li>Any outstanding obligations under these Terms survive termination</li>
        </ul>
      </section>

      <section id="governing-law" className={styles.section}>
        <h2 className={styles.heading}>12. Governing Law</h2>
        <p className={styles.text}>
          These Terms shall be governed by and construed in accordance with the laws of the
          jurisdiction in which the developer resides, without regard to its conflict of law
          provisions. Any disputes arising under these Terms shall be resolved through good
          faith negotiation before resorting to formal legal proceedings.
        </p>
      </section>

      <section id="changes" className={styles.section}>
        <h2 className={styles.heading}>13. Changes to Terms</h2>
        <p className={styles.text}>
          We reserve the right to modify these Terms at any time. When changes are made, we
          will update the &quot;Last updated&quot; date at the top of this page. Material
          changes will be communicated through the Service or by email when possible. Your
          continued use of Sakura after changes are posted constitutes your acceptance of
          the updated Terms.
        </p>
      </section>

      <section id="contact" className={styles.section}>
        <h2 className={styles.heading}>14. Contact</h2>
        <p className={styles.text}>
          If you have questions about these Terms of Service, please contact us at:
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
