'use strict';
/* =====================================================================
   Catalog: titles and descriptions for folders (catalog.json on the drive).

   On the first run on a drive (no catalog.json yet) the dashboard describes
   folders from what is inside them. It knows nothing about any drive in
   advance - only file-name patterns of common applications, OS images and
   file types. Folders it can't recognise keep just their name.
   Generated entries carry "auto": true; anything written with
   "Edit description…" is the user's own and is never overwritten.
   ===================================================================== */
const Catalog = (() => {
  const CATS = {
    usb: { icon: 'usb', desc: 'Tools that write ISO images to USB sticks, to install or boot an operating system.' },
    archive: { icon: 'archive', desc: 'Compress and extract ZIP, RAR, 7z and other archives.' },
    browser: { icon: 'box', desc: 'Web browser installers.' },
    media: { icon: 'film', desc: 'Play, record, edit and convert audio and video.' },
    graphics: { icon: 'image', desc: 'Image editing, drawing, 3D and screenshots.' },
    dev: { icon: 'code', desc: 'Programming languages, editors, IDEs and developer tools.' },
    office: { icon: 'doc', desc: 'Office suites, PDF readers and document tools.' },
    utility: { icon: 'chip', desc: 'Tools for cleaning, monitoring and maintaining a PC.' },
    remote: { icon: 'box', desc: 'Remote desktop, SSH/FTP and file-transfer tools.' },
    download: { icon: 'download', desc: 'Download managers and torrent clients.' },
    security: { icon: 'shield', desc: 'Encryption, passwords, VPN and security tools.' },
    virtual: { icon: 'vm', desc: 'Virtual machines and emulators.' },
    runtime: { icon: 'chip', desc: 'Runtimes and drivers that other programs need.' },
    android: { icon: 'phone', desc: 'Phone tools: ADB/fastboot, flashing tools and USB drivers.' },
    chat: { icon: 'box', desc: 'Chat, calls and video meetings.' },
    oswin: { icon: 'disc', desc: 'Windows installation ISOs. Put one on a USB stick with Rufus or Ventoy.' },
    oslinux: { icon: 'disc', desc: 'Linux ISOs you can boot from a USB stick or install.' },
    rescue: { icon: 'disc', desc: 'Bootable tools for repairing, backing up and partitioning disks.' },
    vm: { icon: 'vm', desc: 'Virtual machine disk images.' },
  };

  // Installers, archives and packages ("apps") and bootable images ("os").
  const APP_EXT = /\.(exe|msi|msix|appx|zip|7z|rar|dmg|pkg|deb|rpm|appimage|tar\.(gz|xz|bz2)|tgz|apk|run|jar)$/i;
  const DISK_EXT = /\.(iso|img)$/i;
  const VM_EXT = /\.(vdi|vmdk|vhdx?|qcow2|ova)$/i;

  // [pattern, title, category, description]
  const APPS = [
    [/^rufus/i, 'Rufus', 'usb', 'Fast, portable bootable-USB creator for Windows and Linux ISOs.'],
    [/balena.?etcher/i, 'balenaEtcher', 'usb', 'Simple image flasher: pick an image, pick a drive, flash. Verifies the write.'],
    [/^ventoy/i, 'Ventoy', 'usb', 'Install once on a USB stick, then copy several ISOs onto it and pick one at boot.'],
    [/unetbootin/i, 'UNetbootin', 'usb', 'Creates bootable live USB drives for Linux.'],
    [/win32diskimager/i, 'Win32 Disk Imager', 'usb', 'Writes raw disk images to USB sticks and SD cards.'],
    [/^yumi/i, 'YUMI', 'usb', 'Multiboot USB creator.'],
    [/raspberry.?pi.?imager|imager_\d/i, 'Raspberry Pi Imager', 'usb', 'Writes operating systems to SD cards for a Raspberry Pi.'],
    [/media.?creation.?tool/i, 'Media Creation Tool', 'usb', "Microsoft's tool to download Windows and make install media."],
    [/^winrar|^wrar/i, 'WinRAR', 'archive', 'Archive manager for RAR, ZIP, 7z and more.'],
    [/^7z\d|7-?zip/i, '7-Zip', 'archive', 'Free open-source archiver with high compression.'],
    [/peazip/i, 'PeaZip', 'archive', 'Free archiver supporting 200+ formats.'],
    [/bandizip/i, 'Bandizip', 'archive', 'Fast archiver for ZIP, 7z, RAR and more.'],
    [/chromesetup|googlechrome|chrome.?standalone/i, 'Google Chrome', 'browser', "Google's web browser."],
    [/firefox/i, 'Mozilla Firefox', 'browser', 'Open-source web browser by Mozilla.'],
    [/brave/i, 'Brave', 'browser', 'Privacy-focused browser with a built-in ad blocker.'],
    [/operasetup|^opera/i, 'Opera', 'browser', 'Web browser with a built-in VPN and ad blocker.'],
    [/vivaldi/i, 'Vivaldi', 'browser', 'Highly customisable web browser.'],
    [/microsoftedge|msedge/i, 'Microsoft Edge', 'browser', "Microsoft's web browser."],
    [/tor.?browser/i, 'Tor Browser', 'browser', 'Browser for anonymous browsing over Tor.'],
    [/^vlc/i, 'VLC Media Player', 'media', 'Plays almost every video and audio format.'],
    [/mpc-?(hc|be)/i, 'MPC-HC', 'media', 'Lightweight media player.'],
    [/potplayer/i, 'PotPlayer', 'media', 'Feature-rich media player.'],
    [/k-?lite/i, 'K-Lite Codec Pack', 'media', 'Codecs so Windows can play most video and audio formats.'],
    [/audacity/i, 'Audacity', 'media', 'Free audio recorder and editor.'],
    [/obs-?studio|^obs.?\d/i, 'OBS Studio', 'media', 'Screen recording and live streaming.'],
    [/handbrake/i, 'HandBrake', 'media', 'Converts and compresses video.'],
    [/ffsetup|format.?factory/i, 'Format Factory', 'media', 'Converts video, audio, image and document formats.'],
    [/foobar2000/i, 'foobar2000', 'media', 'Advanced audio player.'],
    [/spotify/i, 'Spotify', 'media', 'Music streaming app.'],
    [/capcut/i, 'CapCut', 'media', 'Video editor.'],
    [/davinci.?resolve/i, 'DaVinci Resolve', 'media', 'Professional video editing and colour grading.'],
    [/shotcut/i, 'Shotcut', 'media', 'Free open-source video editor.'],
    [/kdenlive/i, 'Kdenlive', 'media', 'Free open-source video editor.'],
    [/ffmpeg/i, 'FFmpeg', 'media', 'Command-line toolkit for converting audio and video.'],
    [/yt-?dlp/i, 'yt-dlp', 'media', 'Command-line video downloader.'],
    [/^gimp/i, 'GIMP', 'graphics', 'Free image editor.'],
    [/inkscape/i, 'Inkscape', 'graphics', 'Free vector graphics editor.'],
    [/krita/i, 'Krita', 'graphics', 'Free digital painting app.'],
    [/blender/i, 'Blender', 'graphics', 'Free 3D modelling, animation and rendering.'],
    [/paint\.?net/i, 'Paint.NET', 'graphics', 'Simple, fast image editor for Windows.'],
    [/sharex/i, 'ShareX', 'graphics', 'Screenshots, screen recording and sharing.'],
    [/greenshot/i, 'Greenshot', 'graphics', 'Screenshot tool.'],
    [/irfanview|iview\d/i, 'IrfanView', 'graphics', 'Fast image viewer and converter.'],
    [/^python-?\d/i, 'Python', 'dev', 'Python programming language installer.'],
    [/^node-v|nodejs/i, 'Node.js', 'dev', 'JavaScript runtime.'],
    [/^git-\d|git-for-windows/i, 'Git', 'dev', 'Version control (Git for Windows includes Git Bash).'],
    [/vscode|vs.?code/i, 'Visual Studio Code', 'dev', 'Code editor.'],
    [/vs_(community|professional|enterprise|buildtools)/i, 'Visual Studio', 'dev', "Microsoft's IDE for C#, C++ and more."],
    [/^jdk|openjdk/i, 'Java JDK', 'dev', 'Java Development Kit.'],
    [/^jre|javasetup/i, 'Java Runtime', 'runtime', 'Runs Java programs.'],
    [/android-?studio/i, 'Android Studio', 'dev', 'IDE for Android apps.'],
    [/mingw|w64devkit|msys2/i, 'MinGW (GCC)', 'dev', 'GCC compiler toolchain for Windows (C/C++).'],
    [/codeblocks/i, 'Code::Blocks', 'dev', 'C/C++ IDE.'],
    [/dev-?c\+\+|devcpp/i, 'Dev-C++', 'dev', 'Lightweight C/C++ IDE.'],
    [/^npp\.|notepad\+\+/i, 'Notepad++', 'dev', 'Text and code editor.'],
    [/sublime/i, 'Sublime Text', 'dev', 'Text and code editor.'],
    [/xampp/i, 'XAMPP', 'dev', 'Apache, MariaDB and PHP for local web development.'],
    [/postman/i, 'Postman', 'dev', 'API testing tool.'],
    [/docker/i, 'Docker Desktop', 'dev', 'Run containers on your PC.'],
    [/intellij|ideaic|ideaiu/i, 'IntelliJ IDEA', 'dev', 'Java and Kotlin IDE.'],
    [/pycharm/i, 'PyCharm', 'dev', 'Python IDE.'],
    [/eclipse/i, 'Eclipse', 'dev', 'Java IDE.'],
    [/arduino/i, 'Arduino IDE', 'dev', 'Program Arduino boards.'],
    [/anaconda|miniconda/i, 'Anaconda', 'dev', 'Python distribution for data science.'],
    [/mysql|mariadb/i, 'MySQL / MariaDB', 'dev', 'Database server.'],
    [/postgresql/i, 'PostgreSQL', 'dev', 'Database server.'],
    [/dosbox/i, 'DOSBox', 'dev', 'DOS emulator, handy for running 16-bit programs.'],
    [/nasm|assmsoft/i, 'NASM', 'dev', 'Netwide Assembler for x86 assembly.'],
    [/emu8086/i, 'emu8086', 'dev', '8086 microprocessor emulator.'],
    [/github.?desktop/i, 'GitHub Desktop', 'dev', 'Git app for GitHub.'],
    [/(proplus|homebusiness|home|professional|standard)(20\d\d)?retail|officesetup/i, 'Microsoft Office', 'office', 'Microsoft Office installer. Open the image to mount it, then run Setup.'],
    [/libreoffice/i, 'LibreOffice', 'office', 'Free office suite (Writer, Calc, Impress).'],
    [/onlyoffice/i, 'ONLYOFFICE', 'office', 'Free office suite compatible with Microsoft Office files.'],
    [/wps.?office/i, 'WPS Office', 'office', 'Office suite.'],
    [/acrordr|acrobat|adobe.?reader/i, 'Adobe Acrobat Reader', 'office', 'PDF reader.'],
    [/sumatrapdf/i, 'SumatraPDF', 'office', 'Lightweight PDF and e-book reader.'],
    [/foxit/i, 'Foxit PDF Reader', 'office', 'PDF reader.'],
    [/obsidian/i, 'Obsidian', 'office', 'Markdown note-taking app.'],
    [/ccleaner|ccsetup/i, 'CCleaner', 'utility', 'Cleans temporary files.'],
    [/^everything/i, 'Everything', 'utility', 'Instant file search for Windows.'],
    [/treesize/i, 'TreeSize', 'utility', 'Shows what is using disk space.'],
    [/windirstat/i, 'WinDirStat', 'utility', 'Visualises disk usage.'],
    [/crystaldiskinfo/i, 'CrystalDiskInfo', 'utility', 'Checks drive health.'],
    [/crystaldiskmark/i, 'CrystalDiskMark', 'utility', 'Measures drive speed.'],
    [/hwinfo/i, 'HWiNFO', 'utility', 'Hardware information and sensors.'],
    [/cpu-?z/i, 'CPU-Z', 'utility', 'CPU, RAM and motherboard details.'],
    [/gpu-?z/i, 'GPU-Z', 'utility', 'Graphics card details.'],
    [/revo.?uninstaller|revosetup/i, 'Revo Uninstaller', 'utility', 'Removes programs and their leftovers.'],
    [/powertoys/i, 'Microsoft PowerToys', 'utility', 'Handy extra tools for Windows.'],
    [/minitool|partition.?wizard/i, 'MiniTool Partition Wizard', 'utility', 'Partition manager.'],
    [/macrium/i, 'Macrium Reflect', 'utility', 'Disk imaging and backup.'],
    [/adksetup|adkwinpe/i, 'Windows ADK', 'utility', 'Assessment and Deployment Kit: DISM, WinPE and deployment tools.'],
    [/teamviewer/i, 'TeamViewer', 'remote', 'Remote desktop and support.'],
    [/anydesk/i, 'AnyDesk', 'remote', 'Remote desktop.'],
    [/rustdesk/i, 'RustDesk', 'remote', 'Open-source remote desktop.'],
    [/putty/i, 'PuTTY', 'remote', 'SSH and serial terminal.'],
    [/winscp/i, 'WinSCP', 'remote', 'SFTP and FTP file transfer.'],
    [/filezilla/i, 'FileZilla', 'remote', 'FTP and SFTP client.'],
    [/localsend/i, 'LocalSend', 'remote', 'Share files between nearby devices.'],
    [/idman|internet.?download.?manager/i, 'Internet Download Manager', 'download', 'Download accelerator with browser integration.'],
    [/qbittorrent/i, 'qBittorrent', 'download', 'Open-source torrent client.'],
    [/utorrent/i, 'µTorrent', 'download', 'Torrent client.'],
    [/fdm_|free.?download.?manager/i, 'Free Download Manager', 'download', 'Download accelerator.'],
    [/jdownloader/i, 'JDownloader', 'download', 'Download manager.'],
    [/veracrypt/i, 'VeraCrypt', 'security', 'Open-source disk and container encryption.'],
    [/bitwarden/i, 'Bitwarden', 'security', 'Password manager.'],
    [/keepass/i, 'KeePass', 'security', 'Offline password manager.'],
    [/malwarebytes|mb\d-setup/i, 'Malwarebytes', 'security', 'Anti-malware scanner.'],
    [/wireshark/i, 'Wireshark', 'security', 'Network traffic analyser.'],
    [/nmap/i, 'Nmap', 'security', 'Network scanner.'],
    [/openvpn/i, 'OpenVPN', 'security', 'VPN client.'],
    [/wireguard/i, 'WireGuard', 'security', 'VPN client.'],
    [/virtualbox/i, 'VirtualBox', 'virtual', 'Free virtual machine software.'],
    [/vmware/i, 'VMware', 'virtual', 'Virtual machine software.'],
    [/bluestacks/i, 'BlueStacks', 'virtual', 'Android emulator for PC.'],
    [/qemu/i, 'QEMU', 'virtual', 'Machine emulator and virtualiser.'],
    [/vc_?redist|vcredist/i, 'Visual C++ Redistributable', 'runtime', 'Microsoft C++ runtime that many programs need.'],
    [/directx|dxsetup|dxwebsetup/i, 'DirectX Runtime', 'runtime', 'DirectX runtime for games and older apps.'],
    [/windowsdesktop-runtime|dotnet|ndp4\d/i, '.NET Runtime', 'runtime', 'Microsoft .NET runtime.'],
    [/nvidia|geforce/i, 'NVIDIA driver', 'runtime', 'Graphics driver.'],
    [/radeon|adrenalin|amd-software/i, 'AMD graphics driver', 'runtime', 'Graphics driver.'],
    [/realtek/i, 'Realtek driver', 'runtime', 'Audio or network driver.'],
    [/platform-tools/i, 'Android Platform-Tools', 'android', "Google's official adb and fastboot."],
    [/minimal.?adb/i, 'Minimal ADB and Fastboot', 'android', 'Small adb/fastboot installer.'],
    [/sp.?flash.?tool/i, 'SP Flash Tool', 'android', 'MediaTek flash tool for scatter-based firmware.'],
    [/mtkclient/i, 'mtkclient', 'android', 'MediaTek BootROM tool: read/write partitions and unlock.'],
    [/mtk.?driver|mediatek.*driver|mtk.?usb/i, 'MediaTek USB driver', 'android', 'Lets flashing tools see MediaTek phones.'],
    [/usb_driver_r\d|google.?usb.?driver/i, 'Google USB Driver', 'android', 'ADB/fastboot driver for Android devices.'],
    [/^odin/i, 'Odin', 'android', 'Samsung firmware flasher.'],
    [/miflash|xiaomi.?flash/i, 'Mi Flash Tool', 'android', 'Xiaomi firmware flasher.'],
    [/qpst|qfil/i, 'QPST / QFIL', 'android', 'Qualcomm flashing tools.'],
    [/realme.?flash/i, 'Realme Flash Tool', 'android', 'Realme firmware flasher.'],
    [/scrcpy/i, 'scrcpy', 'android', 'Mirror and control an Android phone from your PC.'],
    [/magisk/i, 'Magisk', 'android', 'Android rooting tool.'],
    [/twrp/i, 'TWRP', 'android', 'Custom Android recovery.'],
    [/discord/i, 'Discord', 'chat', 'Voice, video and text chat.'],
    [/zoominstaller|zoom.?setup/i, 'Zoom', 'chat', 'Video meetings.'],
    [/telegram|^tsetup/i, 'Telegram Desktop', 'chat', 'Messaging app.'],
    [/whatsapp/i, 'WhatsApp Desktop', 'chat', 'Messaging app.'],
    [/skype/i, 'Skype', 'chat', 'Calls and chat.'],
    [/slack/i, 'Slack', 'chat', 'Team chat.'],
  ];
  // Specific names first (e.g. Lubuntu before Ubuntu, Slax before Debian).
  const OS = [
    [/win(?:dows)?[ _.-]?server/i, 'Windows Server', 'oswin', 'Windows Server installation image.'],
    [/win(?:dows)?[ _.-]?(11|10|8\.1|8|7|xp|vista)(?![\d.])/i, (m, n) => 'Windows ' + m[1].toUpperCase() + ((n.match(/\d\dH\d/i) || [''])[0] ? ' ' + n.match(/\d\dH\d/i)[0].toUpperCase() : ''), 'oswin', 'Windows installation ISO.'],
    [/gparted/i, 'GParted Live', 'rescue', 'Bootable partition editor.'],
    [/clonezilla/i, 'Clonezilla', 'rescue', 'Disk cloning and imaging.'],
    [/hiren/i, "Hiren's BootCD PE", 'rescue', 'Windows-based rescue toolkit.'],
    [/systemrescue/i, 'SystemRescue', 'rescue', 'Linux rescue toolkit.'],
    [/memtest/i, 'Memtest86+', 'rescue', 'Tests RAM for errors.'],
    [/rescuezilla/i, 'Rescuezilla', 'rescue', 'Backup and recovery.'],
    [/virtio-win/i, 'VirtIO drivers', 'runtime', 'Disk and network drivers for Windows guests on KVM/QEMU/Proxmox.'],
    [/lubuntu/i, 'Lubuntu', 'oslinux', 'Lightweight Ubuntu flavour.'],
    [/kubuntu/i, 'Kubuntu', 'oslinux', 'Ubuntu with the KDE Plasma desktop.'],
    [/xubuntu/i, 'Xubuntu', 'oslinux', 'Ubuntu with the Xfce desktop.'],
    [/ubuntu/i, 'Ubuntu', 'oslinux', 'Popular, beginner-friendly Linux distribution.'],
    [/linux-?mint/i, 'Linux Mint', 'oslinux', 'Friendly, Windows-like Linux distribution.'],
    [/linux-?lite/i, 'Linux Lite', 'oslinux', 'Lightweight, beginner-friendly Linux distribution.'],
    [/slax/i, 'Slax', 'oslinux', 'Tiny portable live Linux that runs from USB.'],
    [/fedora/i, 'Fedora', 'oslinux', 'Cutting-edge Linux distribution.'],
    [/kali/i, 'Kali Linux', 'oslinux', 'Linux distribution for security testing.'],
    [/debian/i, 'Debian', 'oslinux', 'Stable, universal Linux distribution.'],
    [/archlinux|^arch-/i, 'Arch Linux', 'oslinux', 'Minimal, rolling-release Linux distribution.'],
    [/manjaro/i, 'Manjaro', 'oslinux', 'User-friendly Arch-based distribution.'],
    [/pop-?os/i, 'Pop!_OS', 'oslinux', 'Ubuntu-based distribution by System76.'],
    [/zorin/i, 'Zorin OS', 'oslinux', 'Windows-like Linux for beginners.'],
    [/elementary/i, 'elementary OS', 'oslinux', 'macOS-like Linux distribution.'],
    [/opensuse/i, 'openSUSE', 'oslinux', 'Linux distribution.'],
    [/rocky|almalinux|centos/i, 'Enterprise Linux', 'oslinux', 'Red Hat-compatible server distribution.'],
    [/tails/i, 'Tails', 'oslinux', 'Privacy-focused live system.'],
    [/proxmox/i, 'Proxmox VE', 'virtual', 'Virtualization platform.'],
    [/truenas/i, 'TrueNAS', 'oslinux', 'Storage (NAS) operating system.'],
  ];

  // Folder-name hints: an icon, and a description when content alone says little.
  const KEYWORDS = [
    [/backup/i, 'backup', 'Backup copies of files and folders.'],
    [/course|lecture|tutorial|lesson|class|udemy|coursera/i, 'book', 'Course material and lectures.'],
    [/driver/i, 'chip', 'Device drivers.'],
    [/firmware|stock.?rom|\brom\b/i, 'phone', 'Firmware images.'],
    [/android|phone|mobile|samsung|xiaomi|oppo|realme|iphone/i, 'phone', null],
    [/\biso\b|isos|operating.?system|os.?images/i, 'disc', null],
    [/software|apps|programs|setups?|installers?|tools|utilities/i, 'box', null],
    [/music|songs|audio|podcast/i, 'music', null],
    [/photo|picture|image|wallpaper|screenshot|camera|dcim/i, 'image', null],
    [/video|movie|film|series|tv.?shows/i, 'film', null],
    [/doc|paper|book|ebook|pdf|universit|assignment|notes|study/i, 'doc', null],
    [/project|code|src|dev|programming|repo/i, 'code', null],
    [/\bvm\b|virtual/i, 'vm', null],
  ];
  const GROUPS = {
    video: ['mp4 mkv avi mov webm wmv flv m4v', 'videos', 'film'],
    audio: ['mp3 wav flac m4a ogg aac wma', 'music and audio', 'music'],
    image: ['png jpg jpeg gif bmp webp heic svg', 'pictures', 'image'],
    doc: ['pdf doc docx odt txt md ppt pptx xls xlsx ods csv rtf epub', 'documents', 'doc'],
    disk: ['iso img', 'disk images', 'disc'],
    archive: ['zip rar 7z tar gz bz2 xz tgz', 'archives', 'zip'],
    installer: ['exe msi msix deb rpm appimage apk dmg pkg', 'installers', 'installer'],
    code: ['py js ts html css java c cpp h cs ps1 sh bat json xml asm ipynb sql', 'code and scripts', 'code'],
  };
  const EXT_GROUP = {};
  for (const [g, [exts]] of Object.entries(GROUPS)) for (const e of exts.split(' ')) EXT_GROUP[e] = g;

  /* ---------------- recognising files ---------------- */
  function versionOf(name) {
    const base = name.replace(/\.(tar\.)?[a-z0-9]+$/i, '');
    const m = base.match(/(?:^|[^\d.])(\d+(?:[._]\d+){1,3})(?![\d])/);
    return m ? m[1].replace(/_/g, '.') : '';
  }
  function matchFile(name) {
    if (VM_EXT.test(name)) return { title: 'Virtual machine disk', cat: 'vm', desc: CATS.vm.desc, noVersion: true };
    const lists = DISK_EXT.test(name) ? [OS, APPS] : APP_EXT.test(name) ? [APPS] : [];
    for (const list of lists) {
      for (const [re, title, cat, desc] of list) {
        const m = name.match(re);
        if (m) return { title: typeof title === 'function' ? title(m, name) : title, cat, desc, noVersion: typeof title === 'function' || cat === 'oswin' };
      }
    }
    return null;
  }
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const listText = (names) => {
    const u = [...new Set(names)];
    return u.length <= 4 ? u.join(', ').replace(/, ([^,]*)$/, ' and $1') : `${u.slice(0, 3).join(', ')} and ${u.length - 3} more`;
  };
  function majority(values) {
    const count = {};
    values.forEach((v) => { count[v] = (count[v] || 0) + 1; });
    return Object.entries(count).sort((a, b) => b[1] - a[1])[0] || [null, 0];
  }

  /* ---------------- describing a folder ---------------- */
  // node: { path, name, files:[{n,s}], fileCount, dirs:[names] };  known: path(lowercase) -> entry of sub-folders
  function describe(node, known) {
    const files = node.files || [];

    // 1. One recognised app / OS image makes up the folder -> it's that app's folder.
    const hits = files.map((f) => ({ f, r: matchFile(f.n) })).filter((x) => x.r);
    const byTitle = {};
    hits.forEach((x) => { (byTitle[x.r.title] = byTitle[x.r.title] || []).push(x); });
    const titles = Object.keys(byTitle);
    if (titles.length === 1) {
      const list = byTitle[titles[0]];
      const r = list[0].r;
      const nameHint = norm(node.name).includes(norm(r.title).slice(0, 5));
      if (list.length / Math.max(1, files.length) >= 0.5 || nameHint) {
        const versions = [...new Set(list.map((x) => versionOf(x.f.n)).filter(Boolean))];
        const v = !r.noVersion && versions.length === 1 ? ' ' + versions[0] : '';
        return { title: r.title + v, desc: r.desc, icon: CATS[r.cat].icon, cat: r.cat, auto: true };
      }
    }
    if (titles.length >= 2 && hits.length / Math.max(1, files.length) >= 0.5) {
      const [cat, n] = majority(hits.map((x) => x.r.cat));
      const same = n / hits.length >= 0.6;
      return { desc: (same ? CATS[cat].desc + ' ' : '') + `Includes ${listText(titles)}.`, icon: same ? CATS[cat].icon : 'installer', cat: same ? cat : undefined, auto: true };
    }

    // 2. Sub-folders that were recognised -> a category folder ("Bootable USB tools: Rufus, Ventoy…").
    const kids = (node.dirs || []).map((d) => known[(node.path + '/' + d).toLowerCase()]).filter(Boolean);
    const kidCats = kids.map((k) => k.cat).filter(Boolean);
    const kidTitles = kids.map((k) => k.title).filter(Boolean);
    const OS_FAMILY = ['oswin', 'oslinux', 'rescue'];
    if (kidCats.length >= 2 && kidCats.every((c) => OS_FAMILY.includes(c)) && new Set(kidCats).size > 1) {
      return { desc: `Operating system images. Includes ${listText(kidTitles)}.`, icon: 'disc', cat: 'oslinux', auto: true };
    }
    if (kidCats.length >= 2) {
      const [cat, n] = majority(kidCats);
      if (n / kidCats.length >= 0.6) {
        return { desc: CATS[cat].desc + (kidTitles.length ? ` Includes ${listText(kidTitles)}.` : ''), icon: CATS[cat].icon, cat, auto: true };
      }
      if (kidTitles.length >= 2) return { desc: `Includes ${listText(kidTitles)}.`, icon: 'box', auto: true };
    }

    // 3. Folder-name hints and the kind of files inside.
    const kw = KEYWORDS.find(([re]) => re.test(node.name));
    const groups = {};
    const exts = {};
    for (const f of files) {
      const ext = (f.n.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
      const g = ext && EXT_GROUP[ext];
      if (!g) continue;
      groups[g] = (groups[g] || 0) + 1;
      (exts[g] = exts[g] || {})[ext] = (exts[g][ext] || 0) + 1;
    }
    const [g, n] = majority(Object.keys(groups).flatMap((k) => Array(groups[k]).fill(k)));
    let content = null;
    if (g && n >= 2 && n / Math.max(1, files.length) >= 0.6) {
      const top = Object.entries(exts[g]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([e]) => e.toUpperCase()).join('/');
      const total = node.fileCount > files.length ? node.fileCount : n;
      content = { text: `Mostly ${GROUPS[g][1]} (${total} ${top} files).`, icon: GROUPS[g][2] };
    }
    if (!kw && !content) return null;
    const desc = [kw && kw[2], content && content.text].filter(Boolean).join(' ');
    return { ...(desc ? { desc } : {}), icon: (kw && kw[1]) || content.icon, auto: true };
  }

  // Describe every folder (deepest first, so parents can use their sub-folders' results).
  // Existing hand-written entries are kept and never overwritten.
  function generate(dirs, existing) {
    const known = {};
    const byLower = {};
    for (const [k, v] of Object.entries(existing || {})) byLower[k.toLowerCase()] = v;
    const set = {};
    const sorted = dirs.slice().sort((a, b) => b.path.split('/').length - a.path.split('/').length);
    for (const node of sorted) {
      const key = node.path.toLowerCase();
      if (key === 'drive_dashboard' || key.startsWith('drive_dashboard/')) continue;
      const have = byLower[key];
      if (have && !have.auto) { known[key] = have; continue; }
      const d = describe(node, known);
      if (d) { known[key] = d; set[node.path] = d; }
    }
    if (!byLower.drive_dashboard) {
      set.Drive_Dashboard = { title: 'Drive Dashboard', icon: 'grid', auto: true,
        desc: 'This web interface. Open it with Start-Dashboard (.bat on Windows, .command on Mac, .sh on Linux); autolaunch makes it open by itself when the drive is plugged in.' };
    }
    return set;
  }

  /* ---------------- first run ---------------- */
  let firstRunDone = false;
  let welcome = null;          // { described } shown on Home after a first run
  async function firstRun() {
    if (firstRunDone || !state.info?.firstRun || state.info.indexState !== 'ready') return;
    firstRunDone = true;
    try {
      const [cat, tree] = await Promise.all([api('/api/catalog'), api('/api/tree')]);
      if (tree.state !== 'ready') { firstRunDone = false; return; }
      const set = generate(tree.dirs, cat.entries);
      const res = await post('/api/catalog', { set });
      const described = Object.keys(set).filter((k) => k !== 'Drive_Dashboard').length;
      welcome = { described, saved: res.saved };
      state.info.firstRun = false;
      await loadRoots();
      route();
    } catch (e) { firstRunDone = false; handleError(e); }
  }
  function welcomeCard() {
    let dismissed = false;
    try { dismissed = localStorage.getItem('dd-welcome-' + (state.info?.label || '')) === '1'; } catch (_) {}
    if (!welcome || dismissed) return null;
    const p = state.info?.platform;
    const how = p === 'mac' ? 'Drive_Dashboard/autolaunch/Install-AutoLaunch.command'
      : p === 'linux' ? 'sh Drive_Dashboard/autolaunch/install-autolaunch.sh'
        : 'Drive_Dashboard\\autolaunch\\Install-AutoLaunch.bat';
    const card = h('div', { class: 'welcome' },
      h('div', { class: 'welcome-head' }, logo(), h('div', {},
        h('h2', { text: 'Your drive is set up' }),
        h('p', { text: 'This is the first time the dashboard ran on this drive.' })),
      h('button', { class: 'icon-btn', title: 'Dismiss', 'aria-label': 'Dismiss', onclick: () => {
        try { localStorage.setItem('dd-welcome-' + (state.info?.label || ''), '1'); } catch (_) {}
        card.remove();
      } }, icon('x'))),
      h('ul', {},
        h('li', { text: welcome.described
          ? `Described ${welcome.described} folder${welcome.described === 1 ? '' : 's'} from their contents. Right-click a folder › Edit description to change one.`
          : 'No folders were recognised automatically. Right-click a folder › Edit description to add your own.' }),
        !welcome.saved && h('li', { text: 'The drive is read-only on this computer, so the descriptions are only kept until the dashboard stops.' }),
        h('li', {}, 'To open the dashboard automatically when this drive is plugged in, run ', h('code', { text: how }), ' once on this computer.')));
    return card;
  }

  /* ---------------- editing ---------------- */
  async function edit(item) {
    const cur = await api('/api/catalog');
    const key = Object.keys(cur.entries).find((k) => k.toLowerCase() === item.path.toLowerCase());
    const entry = key ? cur.entries[key] : {};
    const titleInp = h('input', { class: 'dlg-input', type: 'text', placeholder: item.name, 'aria-label': 'Title' });
    const descInp = h('textarea', { class: 'dlg-input dlg-area', rows: '3', placeholder: 'What is in this folder?', 'aria-label': 'Description' });
    titleInp.value = entry.title || '';
    descInp.value = entry.desc || '';
    const r = await Files.dialog({
      title: 'Edit description', message: `Shown on the card for “${item.name}”.`, wide: true,
      body: h('div', { class: 'dlg-fields' }, h('label', {}, 'Title', titleInp), h('label', {}, 'Description', descInp)),
      buttons: [key && { text: 'Remove', value: 'remove', danger: true }, { text: 'Cancel', value: 'no' }, { text: 'Save', value: 'ok', primary: true }].filter(Boolean),
    });
    if (!r || r.button === 'no') return;
    const value = r.button === 'remove' ? null
      : { title: titleInp.value.trim(), desc: descInp.value.trim(), icon: entry.icon, cat: entry.cat };
    try {
      await post('/api/catalog', { set: { [key || item.path]: value } });
      toast(value ? 'Description saved' : 'Description removed');
      await loadRoots();
      route();
    } catch (e) { handleError(e); }
  }

  return { firstRun, welcomeCard, edit, generate, describe, matchFile };
})();
