import { useAppState } from './state/appState'
import { useSettings } from './state/settings'
import { Onboarding } from './components/onboarding/Onboarding'
import { Shell } from './components/shell/Shell'

function App() {
  const app = useAppState()
  const settings = useSettings()

  if (!app.onboarding) {
    return <Onboarding onDone={app.completeOnboarding} />
  }

  return <Shell app={app} settings={settings} />
}

export default App
