import { useAppState } from './state/appState'
import { useSettings } from './state/settings'
import { Onboarding } from './components/onboarding/Onboarding'
import { WORLD_SHELLS, loadWorld } from './worlds'
import { Component, Suspense, useEffect, type ReactNode } from 'react'

/** A world whose code fails to load or render falls back to Katalog instead of a blank window. */
class WorldBoundary extends Component<
  { fallback: ReactNode; onFail: () => void; children: ReactNode },
  { failed: boolean; reset: boolean }
> {
  state = { failed: false, reset: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  // Katalog takes over on the home screen, not on the view that failed: when that
  // was a shared module view, Katalog would fail on it too and blank the window.
  componentDidCatch() {
    this.props.onFail()
    this.setState({ reset: true })
  }
  render() {
    if (!this.state.failed) return this.props.children
    return this.state.reset ? this.props.fallback : null
  }
}

function App() {
  const app = useAppState()
  const settings = useSettings()
  const world = settings.settings.world
  useEffect(() => loadWorld(world), [world])

  if (!app.onboarding) {
    return (
      <Onboarding
        onDone={app.completeOnboarding}
        linuxProfile={app.linuxProfile}
        onProfileChange={app.saveLinuxProfile}
      />
    )
  }

  const Shell = WORLD_SHELLS[world]
  // Another world's code loads on first use; the window stays blank for that moment.
  return (
    <WorldBoundary
      key={world}
      onFail={() => app.setView({ kind: 'dashboard' })}
      fallback={<WORLD_SHELLS.katalog app={app} settings={settings} />}
    >
      <Suspense fallback={null}>
        <Shell app={app} settings={settings} />
      </Suspense>
    </WorldBoundary>
  )
}

export default App
