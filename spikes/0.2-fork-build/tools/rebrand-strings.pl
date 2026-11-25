#!/usr/bin/env perl
# Story 2.2: renames the product in user-visible strings. Generates patches/0006 (Rust string
# literals) and patches/0007 (locale catalogs) from a pristine tree; it is not run by the build.
#
#   perl tools/rebrand-strings.pl rs  <file.rs>...      FigCraft -> Greenfield inside "..." literals
#   perl tools/rebrand-strings.pl toml <file.toml>...   FigCraft -> Greenfield in catalog keys and values
#
# Only the capitalised name changes. Lowercase `figcraft` (crate names, the `.figcraft`
# extension, `figcraft:` message types, `window.figcraft`, `figcraft-server`) is a code identifier
# and stays: the bridge depends on it. Keys and values are renamed together, so a catalog key is
# still the English text the code looks up (the i18n tests check that).
use strict;
use warnings;

my $mode = shift @ARGV;
for my $file (@ARGV) {
    open my $in, '<:raw', $file or die "$file: $!";
    local $/;
    my $src = <$in>;
    close $in;
    my $out = '';
    for my $line (split /(?<=\n)/, $src) {
        if ($mode eq 'rs') {
            if ($line !~ m{^\s*//}) {
                $line =~ s{("(?:[^"\\]|\\.)*")}{ my $s = $1; $s =~ s/FigCraft/Greenfield/g; $s }ge;
            }
        } else {
            $line =~ s/FigCraft/Greenfield/g;
        }
        $out .= $line;
    }
    open my $o, '>:raw', $file or die "$file: $!";
    print $o $out;
    close $o;
}
