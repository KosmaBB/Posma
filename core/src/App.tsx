import { useAppState } from './state/appState'
import { useSettings } from './state/settings'
import { Onboarding } from './components/onboarding/Onboarding'
import { WORLD_SHELLS, loadWorld } from './worlds'
import { Component, Suspense, useEffect, type ReactNode } from 'react'

/** A world whose code fails to load or render falls back to Katalog instead of a blank window. */
class WorldBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
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
    <WorldBoundary key={world} fallback={<WORLD_SHELLS.katalog app={app} settings={settings} />}>
      <Suspense fallback={null}>
        <Shell app={app} settings={settings} />
      </Suspense>
    </WorldBoundary>
  )
}

export default App
