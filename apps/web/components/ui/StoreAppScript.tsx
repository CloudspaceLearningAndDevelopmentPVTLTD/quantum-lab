import { STORE_APP_SCRIPT } from '@/lib/app-shell'

/** Marks <html data-store-app> before first paint inside the store apps. See lib/app-shell.ts. */
export default function StoreAppScript() {
  return (
    // eslint-disable-next-line react/no-danger -- static literal, no user input, and the only way to act before first paint.
    <script dangerouslySetInnerHTML={{ __html: STORE_APP_SCRIPT }} />
  )
}
