/**
 * Public privacy policy. Reachable without auth (required for Google OAuth
 * verification and for the public MCP connector listing).
 */
const UPDATED = 'June 25, 2026'
const CONTACT = 'iamdhishan@gmail.com'

export default function Privacy() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto px-5 py-10 text-gray-800 leading-relaxed">
        <a href="/" className="text-sm text-blue-600 hover:underline">&larr; Back to Fitness Tracker</a>
        <h1 className="text-2xl font-bold text-gray-900 mt-4">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mt-1">Last updated: {UPDATED}</p>

        <Section title="Overview">
          Fitness Tracker is a personal training and nutrition app. This policy explains what
          we collect, how we use it, who we share it with, and the choices you have. We keep
          the data we collect to the minimum needed to run the app.
        </Section>

        <Section title="Information we collect">
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Account.</b> When you sign in with Google we receive your email address, name,
              and Google account id. We do not receive your Google password.</li>
            <li><b>Fitness data you enter.</b> Workouts, sets, weights, exercises, body metrics
              (such as weight and measurements), cardio sessions, nutrition logs, recipes, and goals.</li>
            <li><b>Photos you upload.</b> Meal and nutrition-label photos you choose to scan. They
              are stored in private cloud storage and sent to our AI provider only to estimate the food.</li>
            <li><b>Apple Health (optional, mobile).</b> If you grant permission, we read steps,
              weight, workouts, heart-rate variability, and sleep. We never write to Apple Health.</li>
            <li><b>Coach conversations.</b> Messages you send to the in-app AI coach and its replies.</li>
            <li><b>Technical data.</b> Basic logs and error reports (for example, crash details and
              the time of a request) used to keep the service working.</li>
          </ul>
        </Section>

        <Section title="How we use your information">
          <ul className="list-disc pl-5 space-y-1">
            <li>To provide the app: store and show your training and nutrition data.</li>
            <li>To power AI features: the coach and nutrition estimation send the relevant data
              (your message, recent training/nutrition context, or a food photo) to our AI provider
              to generate a response or an estimate.</li>
            <li>To look up foods: when you search a food we send the search text (not your identity)
              to public food databases.</li>
            <li>To keep the service reliable and secure: error monitoring and abuse prevention.</li>
          </ul>
        </Section>

        <Section title="Connecting AI assistants (MCP connector)">
          You can connect Fitness Tracker to assistants such as Claude or ChatGPT. When you do,
          you sign in with Google to authorize access, and the assistant can read your fitness
          data through our connector to answer your questions. Your conversations with that
          assistant stay with that assistant; we only receive the specific data requests it makes
          on your behalf. You can disconnect the connector at any time from the assistant.
        </Section>

        <Section title="Who we share with (service providers)">
          We do not sell your data. We share data only with providers that help run the app:
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li><b>Google Cloud</b> - hosting, database, and storage.</li>
            <li><b>OpenAI</b> - the AI coach and nutrition estimation (processes your message,
              context, or food photo to produce a response).</li>
            <li><b>Open Food Facts and USDA FoodData Central</b> - food lookups (search text only).</li>
            <li><b>Cloudflare</b> - secure delivery and authentication for the connector.</li>
            <li><b>Sentry</b> - error and crash monitoring.</li>
          </ul>
        </Section>

        <Section title="Data retention and deletion">
          We keep your data while your account is active. You can delete individual entries in the
          app at any time. To delete your account and all associated data, email us at {CONTACT}
          and we will remove it.
        </Section>

        <Section title="Security">
          Data is transmitted over HTTPS and stored in access-controlled cloud infrastructure.
          Every request is authenticated, and your data is isolated to your account. No system is
          perfectly secure, but we work to protect your information.
        </Section>

        <Section title="Health information">
          Fitness Tracker is a personal fitness tool, not a medical device or a provider of medical
          advice. AI estimates (including calories and macros) can be inaccurate. Do not rely on the
          app for medical decisions; consult a qualified professional.
        </Section>

        <Section title="Children">
          The app is not intended for anyone under 16, and we do not knowingly collect data from them.
        </Section>

        <Section title="Changes">
          We may update this policy. We will change the date above and, for material changes, notify
          you in the app.
        </Section>

        <Section title="Contact">
          Questions or deletion requests: <a className="text-blue-600 hover:underline" href={`mailto:${CONTACT}`}>{CONTACT}</a>.
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
