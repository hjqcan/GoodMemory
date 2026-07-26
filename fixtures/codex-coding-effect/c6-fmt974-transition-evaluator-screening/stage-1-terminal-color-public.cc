#include <cstdio>
#include <cstring>
#include "fmt/color.h"

int main() {
  std::FILE* stream = std::tmpfile();
  if (!stream) return 2;
  fmt::print(stream, fmt::fg(fmt::terminal_color::yellow), "Y");
  fmt::print(stream, fmt::bg(fmt::terminal_color::bright_cyan), "C");
  std::fflush(stream);
  std::rewind(stream);
  char output[64] = {};
  const std::size_t size = std::fread(output, 1, sizeof(output) - 1, stream);
  std::fclose(stream);
  const char expected[] = "\x1b[33mY\x1b[0m\x1b[106mC\x1b[0m";
  return size == sizeof(expected) - 1 && std::strcmp(output, expected) == 0
             ? 0
             : 1;
}
