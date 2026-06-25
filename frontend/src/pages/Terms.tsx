/**
 * Public terms of service. Reachable without auth (required for Google OAuth
 * verification and the public MCP connector listing).
 */
const UPDATED = 'June 25, 2026'
const CONTACT = 'iamdhishan@gmail.com'

export default function Terms() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-5 py-10 text-gray-800 leading-relaxed">
        <a href="/" className="text-sm text-blue-600 hover:underline">&larr; Back to Fitness Tracker</a>
        <h1 className="text-2xl font-bold text-gray-900 mt-4">Terms of Service</h1>
        <p className="text-sm text-gray-500 mt-1">Last updated: {UPDATED}</p>

        <Section title="Acceptance">
          By using Fitness Tracker you agree to these terms. If you do not agree, do not use the app.
        </Section>

        <Section title="The service">
          Fitness Tracker lets you log workouts, nutrition, body metrics, and cardio, get AI-assisted
          coaching and nutrition estimates, and optionally connect AI assistants (such as Claude or
          ChatGPT) to your data. The service is provided as-is and may change over time.
        </Section>

        <Section title="Your account">
          You sign in with Google and are responsible for activity under your account. Keep your
          Google account secure. You must provide accurate information and be at least 16 years old.
        </Section>

        <Section title="Acceptable use">
          Do not misuse the service: no attempting to access other users' data, no automated abuse or
          excessive load, no reverse engineering, and no unlawful use. We may rate-limit, suspend, or
          terminate accounts that violate these terms or threaten the service.
        </Section>

        <Section title="AI features and accuracy">
          AI coaching and nutrition estimates are generated automatically and may be incomplete or
          wrong. They are for general information only and are not medical, nutritional, or fitness
          advice. You are responsible for how you use the output. Consult a qualified professional
          before making health decisions, and stop exercising if you feel unwell.
        </Section>

        <Section title="Your content">
          You keep ownership of the data you enter. You grant us permission to store and process it
          to operate the app and the features you use (including sending relevant data to our AI and
          food-lookup providers as described in the Privacy Policy).
        </Section>

        <Section title="No warranty">
          The service is provided "as is" and "as available," without warranties of any kind, to the
          maximum extent permitted by law. We do not guarantee it will be uninterrupted, error-free,
          or accurate.
        </Section>

        <Section title="Limitation of liability">
          To the maximum extent permitted by law, we are not liable for any indirect, incidental, or
          consequential damages, or for any loss of data, arising from your use of the service.
        </Section>

        <Section title="Termination">
          You may stop using the app and request deletion at any time. We may suspend or end access if
          you violate these terms or to protect the service.
        </Section>

        <Section title="Changes">
          We may update these terms. We will change the date above and, for material changes, notify
          you in the app. Continued use after a change means you accept the updated terms.
        </Section>

        <Section title="Contact">
          <a className="text-blue-600 hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      <div className="mt-2 text-[15px]">{children}</div>
    </section>
  )
}
