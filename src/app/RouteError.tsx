/**
 * The root route's error boundary.
 *
 * Mounted above `AppFrame`, so it catches the two failures that leave the user
 * with nothing: the database refusing to open, and a lazy route chunk failing
 * to download. Both are recoverable-looking to the user and neither should
 * present as a blank page.
 *
 * IndexedDB is genuinely unavailable in some real situations — Firefox private
 * windows, Safari with storage blocked, a Capacitor WebView with a corrupt
 * profile — and this app is offline-first, so that failure is fatal rather
 * than degraded. Saying so plainly beats an empty shell that silently drops
 * every write.
 */
import {Banner} from '@astryxdesign/core/Banner';
import {Button} from '@astryxdesign/core/Button';
import {Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {isRouteErrorResponse, useRouteError} from 'react-router';

function describe(error: unknown): {title: string; detail: string} {
  if (isRouteErrorResponse(error)) {
    return {
      title: `${error.status} ${error.statusText}`,
      detail: typeof error.data === 'string' ? error.data : 'Something went wrong.',
    };
  }
  if (error instanceof Error) {
    return {title: 'Finance Tracker could not start', detail: error.message};
  }
  return {title: 'Finance Tracker could not start', detail: String(error)};
}

export function RouteError() {
  const {title, detail} = describe(useRouteError());

  return (
    <Stack height="100dvh" hAlign="center" vAlign="center" padding={6}>
      <Stack gap={4} width="100%" maxWidth={560}>
        <Banner
          status="error"
          title={title}
          description="Your data has not been lost — it is still in this browser's local storage."
          endContent={
            <Button
              label="Reload"
              variant="primary"
              onClick={() => window.location.reload()}
            />
          }
        >
          <Text type="code">{detail}</Text>
        </Banner>
        <Text type="supporting" as="p">
          If reloading does not help, local storage may be blocked. Private
          browsing windows and blocked site data both prevent this app from
          opening its database.
        </Text>
      </Stack>
    </Stack>
  );
}
