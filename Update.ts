export const VERSION = "47";

// a release candidate (N.rcM, a pre-release on the rc branch) is only ever
// installed by hand, with its own release's install line
const RC = /\.rc[0-9]+$/.test(VERSION);

const BASE = "https://github.com/arteeh/ki/releases/" + (RC ? "download/" + VERSION : "latest/download");

// a release candidate's own install line, else the latest release's
export function install_cmd(win: boolean): string {
  return win ? "irm " + BASE + "/install.ps1 | iex" : "curl -fsSL " + BASE + "/install.sh | sh";
}
