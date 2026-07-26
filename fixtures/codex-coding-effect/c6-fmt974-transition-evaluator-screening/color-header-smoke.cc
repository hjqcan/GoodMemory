#include "fmt/color.h"

int main() {
  const fmt::text_style style =
      fmt::fg(fmt::rgb(0x112233u)) | fmt::bg(fmt::color::blue);
  return style.has_foreground() && style.has_background() ? 0 : 1;
}
