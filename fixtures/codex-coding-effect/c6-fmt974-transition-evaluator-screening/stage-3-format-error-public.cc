#include <cstring>
#include "fmt/color.h"

int main(int argc, char**) {
  try {
    if (argc == 1) {
      (void)(fmt::fg(fmt::terminal_color::red) |
             fmt::fg(fmt::terminal_color::green));
    } else {
      (void)(fmt::bg(fmt::terminal_color::red) &
             fmt::bg(fmt::terminal_color::green));
    }
  } catch (const fmt::format_error& error) {
    const char* expected = argc == 1 ? "can't OR a terminal color"
                                    : "can't AND a terminal color";
    return std::strcmp(error.what(), expected) == 0 ? 0 : 2;
  }
  return 1;
}
