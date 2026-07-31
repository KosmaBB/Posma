import { useAppState } from './state/appState'
import { Onboarding } from './components/onboarding/Onboarding'
import { Shell } from './components/shell/Shell'

function App() {
  const app = useAppState()

  if (!app.onboarding) {
    return <Onboarding onDone={app.completeOnboarding} />
  }

  return <Shell app={app} />
}

export default App
