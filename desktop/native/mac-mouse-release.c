/*
 * Observe the physical button state while AppKit owns a frameless-window drag.
 * This never installs a global event tap, injects input, or requests accessibility
 * access. It exits only after both left and right buttons have been released.
 */
#include <ApplicationServices/ApplicationServices.h>
#include <stdio.h>
#include <stdbool.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
  if (argc == 2 && strcmp(argv[1], "--probe") == 0) {
    const bool pressed = CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft);
    printf("%d\n", pressed ? 1 : 0);
    return 0;
  }
  for (int attempt = 0; attempt < 7500; ++attempt) {
    const bool left = CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonLeft);
    const bool right = CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, kCGMouseButtonRight);
    if (!left && !right) return 0;
    usleep(16000);
  }
  return 2;
}
