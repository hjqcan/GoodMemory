#include <cstdio>
#include <cstring>
#include "fmt/color.h"

int main() {
  std::FILE* stream = std::tmpfile();
  if (!stream) return 2;
  const fmt::rgb value(0x1e112233u);
  fmt::print(stream, fmt::fg(value), "F");
  fmt::print(stream, fmt::bg(value), "B");
  std::fflush(stream);
  std::rewind(stream);
  char output[96] = {};
  const std::size_t size = std::fread(output, 1, sizeof(output) - 1, stream);
  std::fclose(stream);
  const char expected[] =
      "\x1b[38;2;017;034;051mF\x1b[0m"
      "\x1b[48;2;017;034;051mB\x1b[0m";
  return size == sizeof(expected) - 1 && std::strcmp(output, expected) == 0
             ? 0
             : 1;
}
