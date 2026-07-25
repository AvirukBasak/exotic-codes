# 5G Hotspot Restrictions — How It All Works

A deep dive into how carriers detect and restrict hotspot/tethering traffic, how the
underlying mobile network architecture works, and how to route around it on Linux.

---

## Table of Contents

1. [How Carriers Detect Tethering](#1-how-carriers-detect-tethering)
2. [The Android Subsystem Stack](#2-the-android-subsystem-stack)
3. [5G vs 4G — What Actually Downgrades](#3-5g-vs-4g--what-actually-downgrades)
4. [Radio and Service Are Decoupled](#4-radio-and-service-are-decoupled)
5. [Thermal Throttling — The Real Radio Switch](#5-thermal-throttling--the-real-radio-switch)
6. [What Is a Bearer](#6-what-is-a-bearer)
7. [APNs and How They Drive Policy](#7-apns-and-how-they-drive-policy)
8. [fwmark — The Internal Packet Tag](#8-fwmark--the-internal-packet-tag)
9. [APN Settings Fields Explained](#9-apn-settings-fields-explained)
10. [Jio Specifically — Single APN, DPI-Based Detection](#10-jio-specifically--single-apn-dpi-based-detection)
11. [Why TTL Alone Is Not Enough](#11-why-ttl-alone-is-not-enough)
12. [The Bypass Approaches](#12-the-bypass-approaches)
13. [NetShare — How It Works](#13-netshare--how-it-works)
14. [WiFi Direct and Why NetShare Uses It](#14-wifi-direct-and-why-netshare-uses-it)
15. [tun2socks — Transparent Proxying](#15-tun2socks--transparent-proxying)
16. [Routing, Metrics, and the Default Route Problem](#16-routing-metrics-and-the-default-route-problem)
17. [DNS Handling](#17-dns-handling)
18. [Per-App Proxy Behaviour on Linux](#18-per-app-proxy-behaviour-on-linux)
19. [Setup Scripts](#19-setup-scripts)

---

## 1. How Carriers Detect Tethering

Carriers use several detection layers, applied in combination:

### TTL Inspection

Every IP packet has a TTL (Time To Live) field — an integer decremented by 1 at each
hop. When your Android device generates traffic itself, packets leave with TTL = 64
(Linux kernel default). When Android *forwards* hotspot traffic from another device,
the kernel decrements TTL before forwarding — so packets arrive at the carrier with
TTL = 63. The carrier's DPI equipment sees TTL ≠ 64 and flags the packet as tethered.

This is the simplest, most reliable detection method and is universally deployed.

### DPI — Deep Packet Inspection

Carriers run DPI appliances (Sandvine, Ericsson TAS, Cisco SCE) that inspect traffic
beyond just the TTL:

- **TCP window size and scaling factors** — desktop OS TCP stacks have different
  defaults than Android's
- **Passive OS fingerprinting (p0f-style)** — the combination of TCP options, window
  size, and TTL uniquely identifies the OS. A Linux desktop has a distinct fingerprint
  from Android.
- **TLS ClientHello / JA3 fingerprint** — every OS and browser produces a different
  TLS handshake signature. Chrome on Linux differs from Chrome on Android.
- **DNS query patterns** — systemd-resolved behaves differently from Android's
  resolver. LLMNR, mDNS probes, different query timing.
- **HTTP User-Agent strings** — desktop browsers send `X11; Linux x86_64` in their
  User-Agent.
- **Protocol mix** — a phone is unlikely to sustain 50 Mbps for two hours pulling
  apt packages, doing SSH, and running Windows Update simultaneously.
- **Flow volume patterns** — large sustained flows from a "phone" are suspicious.

No single signal is conclusive — the DPI box scores them collectively.

### APN / Bearer Tagging

On devices and carriers that use a dedicated tethering APN (see section 7), the APN
name itself tells the carrier core what service class to apply — no DPI needed at all.
This is the cleaner, more reliable approach from the carrier's perspective.

### Carrier Entitlement Check

Android's `TetheringManager` phones home to a carrier entitlement server URL
embedded in `CarrierConfigManager` before the hotspot even activates. The server
responds with whether this SIM/plan is allowed to tether. This is the gate that
produces the "Contact your carrier to enable hotspot" message.

---

## 2. The Android Subsystem Stack

Tethering control is layered across several Android subsystems:

```
Android Telephony Framework
  TelephonyManager, PhoneSubInfoController
  — checks carrier config for tethering entitlement

        ↓

Connectivity Service / TetheringManager
  frameworks/base/services/core/java/.../ConnectivityService.java
  — decides if tethering is allowed
  — talks to carrier entitlement servers

        ↓

Tethering APEX Module
  /apex/com.android.tethering
  — extracted from core OS since Android 11
  — manages WiFi hotspot, USB, Bluetooth tethering
  — sets up iptables / nftables rules

        ↓

netd  (Network Daemon)
  /system/bin/netd
  — root-level daemon managing iptables/nftables
  — sets up NAT, packet marking, traffic shaping
  — applies fwmarks

        ↓

Linux Kernel (iptables / nftables)
  — TTL mangling rules
  — fwmark-based routing
  — tc (traffic control) for bandwidth shaping
  — network namespaces
```

When you enable a hotspot, `netd` sets up rules roughly like:

```bash
# NAT for forwarded traffic
iptables -t nat -A POSTROUTING -o rmnet0 -j MASQUERADE

# Mark tethered packets for separate billing/QoS
iptables -t mangle -A FORWARD -j MARK --set-mark 0x2
```

The fwmark `0x2` (or carrier-specific equivalent) tells downstream systems this packet
came from a tethered device.

---

## 3. 5G vs 4G — What Actually Downgrades

**The phone does not switch to 4G when hotspot traffic is detected.** The radio
generation is completely orthogonal to tethering policy.

What changes is the **logical bearer's QoS class** inside the carrier's packet core.
Both the phone's own traffic and the hotspot traffic travel over the same physical 5G
NR radio to the tower. The tower (gNB) is entirely unaware of tethering policy —
it just forwards radio frames.

The restriction is enforced at the **UPF / PGW (packet core)**, not at the radio:

```
UE (phone)
    │  ← 5G NR radio, unchanged →
  gNB (tower)  — sees nothing, just GTP-U packets
    │
  UPF / PGW  ← restriction enforced HERE
    │
    ├── your own traffic   → QCI 9, unlimited 5G bucket
    └── hotspot traffic    → QCI 8, throttled, daily bucket
```

In the Airtel case: hotspot traffic is reclassified and deducted from the standard
daily 4G/5G data limit rather than the unlimited 5G bucket. The radio still carries
it over 5G NR. The "4G" label refers to the billing bucket, not the radio technology.

---

## 4. Radio and Service Are Decoupled

The NR radio provides raw **capacity** — bits per second over the air. The actual
service quality (throughput, latency, quota) is determined entirely by what the core
network decides to deliver through that capacity.

You could be on mmWave 5G with 2 Gbps physical layer capacity and the core could be
feeding your bearer at 128 kbps. The radio is an idle highway with a software tollbooth
in the middle.

### How Throughput Is Actually Limited

The UPF enforces throughput through three mechanisms simultaneously:

**Token bucket / traffic shaper (primary)** — a policer drains tokens at the
configured rate (e.g. 1 Mbps). Any burst beyond that is dropped or delayed. This
is a hard ceiling regardless of radio conditions.

**QoS bearer priority (secondary)** — each logical bearer has a QFI with an
associated MBR (Maximum Bit Rate). The UPF enforces this ceiling at session
establishment.

**Buffer / queue allocation** — lower priority bearers get smaller queue depth and
higher drop probability under congestion (WRED hits them first). This only matters
under congestion; at 3am even a "throttled" bearer might burst briefly before the
token bucket clamps it.

### This Is By Design — Network Slicing

3GPP explicitly separated RAN from core policy to enable network slicing. The same
physical NR infrastructure can simultaneously serve:

- eMBB slice — high throughput, best effort
- URLLC slice — low latency, guaranteed bitrate
- MIoT slice — low throughput, massive connection density

All over identical radio hardware. The differentiation is 100% core network policy.

---

## 5. Thermal Throttling — The Real Radio Switch

When the phone overheats, an actual radio switch does occur — but this is a completely
separate mechanism from tethering detection.

In **5G NSA (Non-Standalone)** architecture, your phone runs two radios simultaneously:

- **MCG (Master Cell Group)** — LTE anchor, carries control plane and some data
- **SCG (Secondary Cell Group)** — NR secondary, carries bulk data throughput

The NR radio is the hot one. It draws significantly more power because:
- Wider bandwidth to sample
- More MIMO streams to process
- Higher frequency = more path loss = more TX power needed
- Beamforming computation on the modem DSP

When thermals spike, the modem firmware performs an **SCG release** — drops the NR
secondary cell, falls back to LTE anchor only. This is:

- Decided by modem firmware / RIL, not Android OS
- Not a core network policy decision
- A genuine physical radio being powered down
- Immediately reflected in throughput, not just billing

### The Two Downgrades Compared

```
Hotspot throttling              Thermal throttling
──────────────────              ──────────────────
Core network policy             Modem firmware decision
Software token bucket           Physical radio shutdown
Same radio, less quota          Fewer radios active
Defeated by packet spoofing     Defeated only by cooling
```

They can stack — thermally throttled to LTE *and* core rate-limiting your tethering
bearer simultaneously. Two independent ceilings; whichever is lower wins.

---

## 6. What Is a Bearer

A bearer is a **logical tunnel between the UE and the carrier core** with a defined
set of QoS parameters. Think of it as a named pipe with guaranteed characteristics.

Multiple bearers are active simultaneously:

```
Your phone
  │
  ├── Default bearer (always exists while attached)
  │     QCI 9 — best effort internet, no guarantees
  │     → normal data traffic
  │
  ├── Dedicated bearer (created on demand)
  │     QCI 1 — guaranteed bitrate, low latency
  │     → VoLTE voice call
  │
  └── Dedicated bearer (if carrier uses APN separation)
        QCI 8 — throttled tethering
        → hotspot traffic
```

Each bearer has:

- **QCI** — QoS Class Identifier, 1–9, maps to a predefined service profile
  (latency budget, drop priority, guaranteed vs best-effort)
- **GBR** — Guaranteed Bit Rate (for voice/video bearers)
- **MBR** — Maximum Bit Rate (hard ceiling)
- **ARP** — Allocation and Retention Priority (who gets dropped first under congestion)

The default bearer (QCI 9) is established when the phone first attaches to the
network and stays up as long as you have signal. Everything else is spun up and
torn down on demand.

### The Word "Bearer" Is Overloaded

| Context | Meaning |
|---|---|
| APN settings UI | Radio access technology filter (which RATs this APN activates on) |
| 3GPP / core network | Logical QoS tunnel between UE and PGW |
| Old GSM/UMTS docs | The radio channel itself |

These are unrelated despite sharing the name.

---

## 7. APNs and How They Drive Policy

An APN (Access Point Name) is a **named service profile** in the carrier's core.
When Android establishes a PDN (Packet Data Network) connection, it selects an APN,
and the PGW/UPF looks it up and pre-programs the bearer with the associated policy
before a single byte of user data flows.

### Two APNs, Two PDN Connections (carrier-dependent)

Some carriers provision a separate tethering APN:

```
Normal data:    APN "internet"         → PDN 1 → QCI 9, unlimited
Tethering:      APN "tethering"/"dun"  → PDN 2 → QCI 8, throttled/capped
```

Both PDN connections are active simultaneously over the same radio. The APN name
itself tells the core what policy to apply — no DPI needed.

### APN Type Field

The APN type field in Android settings tells Android which traffic class uses this APN:

| Type | Purpose |
|---|---|
| `default` | Normal internet data |
| `supl` | Assisted GPS |
| `xcap` | XML carrier config provisioning |
| `dun` | Tethering / hotspot — "Dial-Up Networking" |
| `ims` | IMS / VoLTE |
| `mms` | MMS messaging |

The absence of `dun` in Jio's APN means Android routes hotspot traffic through the
default APN — putting Jio in detection-by-DPI mode rather than APN-separation mode.

### APN Bearer Field

The bearer field in APN settings is a **whitelist of radio access technologies** on
which this APN is allowed to activate. "Unspecified" means all RATs. Setting it to
LTE+NR only would prevent the APN activating on 3G fallback, for example.
This is entirely separate from the 3GPP bearer concept.

### Carrier Policy Lookup Table (conceptual)

```
APN name       →   QCI    MBR         Quota bucket
────────────────────────────────────────────────────
jionet         →   9      unlimited   5G unlimited
airteltethering→   8      1 Mbps      daily 4G cap
airtelims      →   1      GBR 64kbps  IMS (no cap)
```

---

## 8. fwmark — The Internal Packet Tag

fwmark is a **32-bit integer** the Linux kernel attaches to a packet in memory as it
flows through the networking stack. It never appears on the wire — it is purely
internal kernel metadata, stored in the `sk_buff` struct:

```c
struct sk_buff {
    ...
    __u32    mark;   // the fwmark
    ...
}
```

### Who Sets It

- `iptables -j MARK --set-mark 0x2`
- `nftables meta mark set 0x2`
- `SO_MARK` socket option (per-socket, requires `CAP_NET_ADMIN`)
- `cgroups net_cls` (marks all packets from a cgroup automatically)

Android's `netd` uses iptables/nftables to mark packets passing through the tethering
NAT interface.

### Android's fwmark Layout

Android uses a structured bit layout — different bit ranges encode different meaning:

```
32-bit fwmark
┌──────────┬──────────┬─────────────┬──────────────────┐
│ reserved │ net ID   │ permission  │ special bits      │
│          │ (which   │ flags       │ (tethering, vpn,  │
│          │ network) │             │  etc.)            │
└──────────┴──────────┴─────────────┴──────────────────┘
```

### What Reads It

- **iptables** — match on `-m mark` for further filtering or mangling
- **ip rule** — policy routing: `ip rule add fwmark 0x2 lookup table 100`
- **tc** — traffic control: classify marked packets into a different queue

### The Key Point

The carrier never sees the fwmark — it is gone by the time the packet hits the wire.
But `netd` uses the fwmark to route the packet out through a specific interface bound
to a specific PDN connection (potentially a tethering APN). The carrier sees *which
PDN connection* the packet came from, which is what drives policy. The fwmark is the
internal messenger that determines which door the packet walks out of.

---

## 9. APN Settings Fields Explained

| Field | Meaning |
|---|---|
| MCC | Mobile Country Code — identifies the country. 404/405 = India |
| MNC | Mobile Network Code — identifies the carrier. 873 = Jio |
| APN name | The profile name sent to the carrier core |
| APN type | Which Android traffic class uses this APN (default, dun, ims, etc.) |
| Bearer | Which radio access technologies this APN activates on |
| Proxy | Legacy HTTP proxy IP (WAP era, almost never used now) |
| Server | Legacy WAP gateway (essentially obsolete) |
| Port | Port for the proxy above |
| MMS proxy/port | Separate proxy for MMS traffic |
| MMSC | MMS centre URL |
| Protocol | IP version for the PDN connection (IPv4, IPv6, IPv4v6) |
| APN protocol | Same as above (duplicate field in some Android versions) |
| Authentication | PAP/CHAP auth for the PDN connection |

The proxy/server fields are leftovers from early 2000s carrier architectures where
all traffic was routed through a carrier-operated transparent HTTP proxy for caching
and content filtering. Blank = not used.

---

## 10. Jio Specifically — Single APN, DPI-Based Detection

Jio provisions a single APN (`jionet`) with no `dun` type. This means:

- No separate tethering PDN connection is established
- Hotspot traffic and phone traffic share the same default bearer
- Jio detects tethering purely through **runtime DPI** at the UPF/core level
- TTL inspection, TCP stack fingerprinting, flow patterns — all of it

Jio runs a **5G NSA** network — LTE as anchor (MCG), NR as secondary (SCG). From
the core network's perspective, the PDN connection looks the same whether NR is
active or not. The billing and QoS policy is applied at the core regardless of
which radio is currently carrying the bytes.

---

## 11. Why TTL Alone Is Not Enough

Fixing TTL with iptables:

```bash
iptables -t mangle -A FORWARD -j TTL --ttl-set 64
```

Defeats naive TTL-only detection. But Jio's DPI looks at more:

| Signal | What it reveals |
|---|---|
| TTL = 63 | Forwarded packet (easy fix) |
| TCP window size | Linux desktop has different defaults than Android |
| TCP options order | Passive OS fingerprint differs per OS |
| TLS ClientHello / JA3 | Each OS+browser combo has a unique fingerprint |
| DNS query behaviour | systemd-resolved vs Android resolver are distinct |
| HTTP User-Agent | Desktop browsers advertise Linux in UA string |
| Protocol mix | apt, SSH, desktop update patterns are not phone-like |
| Sustained flow volume | Phones don't sustain high throughput indefinitely |

DPI scores these collectively. Fixing TTL alone removes one signal; the rest remain.

---

## 12. The Bypass Approaches

From simplest to most robust:

### TTL Fix Only
```bash
iptables -t mangle -A FORWARD -j TTL --ttl-set 64
```
Defeats TTL-only detection. Fails against real DPI. Insufficient for Jio.

### VPN on Linux Device
Run WireGuard or OpenVPN on the Linux machine. Traffic exits Android already
encrypted. Jio sees one encrypted flow to a single server IP — indistinguishable
from a phone app using a VPN. Requires a VPN server (Oracle Cloud free tier works).

### WireGuard on Android
Run WireGuard client on Android itself. All hotspot traffic — yours and the Linux
machine's — exits through the tunnel before reaching the modem. Cleanest approach,
no root required, works over WiFi hotspot transparently.

### Reverse/Proxy Tethering (NetShare approach)
The Linux machine doesn't get a real routed internet connection. Instead it sends
requests to a SOCKS5 proxy running on Android. Android opens sockets on Linux's
behalf. Traffic genuinely originates from Android's network stack — correct TTL,
Android TCP fingerprint, no fwmark, no forwarding at all. Defeats IP-layer DPI
completely. No root needed on either end.

### Full Stack Spoof (root, complex)
Fix TTL, randomise TCP window sizes, normalise TLS ClientHello to match Android's
fingerprint. Impersonate Android's stack from Linux. Complex, fragile, breaks with
kernel and browser updates.

---

## 13. NetShare — How It Works

NetShare creates a WiFi network your Linux machine connects to, then runs a SOCKS5
proxy server that Android uses to handle internet connections on Linux's behalf.

### Architecture

```
Linux app wants google.com:443
    │
    │  sends SOCKS5 CONNECT request to 192.168.49.1:8282
    ▼
NetShare proxy on Android
    │
    │  Android's own Java network stack opens socket to google.com:443
    │  from Android's perspective: just an app making a connection
    ▼
Jio core
    │  sees: TCP connection from Android IP to google.com:443
    │  TTL=64, Android TCP stack, no fwmark, no IP forwarding
    │  identical to Chrome on Android
    ▼
google.com
```

### The PAC File

NetShare serves a **PAC (Proxy Auto-Configuration)** file at its hotspot IP. PAC is
a JavaScript file the OS/browser calls for every connection to decide routing:

```javascript
function FindProxyForURL(url, host) {
    if (isInNet(host, "192.168.49.0", "255.255.255.0"))
        return "DIRECT";
    return "SOCKS5 192.168.49.1:8282";
}
```

Configure it in GNOME: Settings → Network → your connection → Proxy → Automatic →
paste the PAC URL NetShare shows. Works for browsers and proxy-aware apps.

### Limitations of SOCKS5 / PAC

Only proxy-aware traffic works automatically. Things that don't:

- Apps that ignore system proxy settings (apt, snap, docker, etc.)
- UDP traffic (SOCKS5 UDP ASSOCIATE rarely implemented correctly)
- ICMP (ping) — not TCP/UDP, cannot be proxied
- Raw sockets
- Anything running as root without inheriting session proxy config

---

## 14. WiFi Direct and Why NetShare Uses It

### Why Not a Normal Hotspot

Android 8+ restricted the API third-party apps can use to create hotspots:

- `WifiManager.startLocalOnlyHotspot()` — only API available to apps without root
- Creates a hotspot but **explicitly blocks internet routing** by design
- Android prevents apps from becoming unauthorised internet sharing points

NetShare sidesteps this by using **WiFi Direct P2P group creation** instead, which:
- Is still accessible to third-party apps
- Creates a genuine 802.11 AP devices can connect to
- Gives NetShare control over the group owner IP
- Is not subject to the LocalOnlyHotspot internet routing block

NetShare then handles "routing" itself at the application layer via SOCKS5.

### What WiFi Direct Actually Is

WiFi Direct (802.11 WiFi P2P) lets two devices connect directly without a router.
One device becomes the Group Owner (soft AP) and others connect to it.

| | Regular Hotspot | WiFi Direct |
|---|---|---|
| Standard | 802.11 infrastructure mode | 802.11 WiFi P2P |
| Discovery | Known SSID | P2P probe/negotiation |
| Auth | WPA2 password | WPS-style negotiation |
| Primary purpose | Internet sharing | P2P file/screen/device sharing |
| SSID format | Your chosen name | Must start with `DIRECT-` |

The `DIRECT-NS-...` SSID is mandated by the WiFi Direct spec — all P2P group SSIDs
must start with `DIRECT-`.

### WPS in NetShare

WPS (Wi-Fi Protected Setup, 2006) is an alternative connection method — instead of
entering the WiFi password you either push a button or enter a PIN. NetShare exposes
it as an option for connecting to its WiFi Direct group.

For connecting your own Linux machine to your own phone: don't use it. WPS has known
security vulnerabilities (Pixie Dust attack brute-forces the PIN in under 2 hours).
Just use the password.

---

## 15. tun2socks — Transparent Proxying

tun2socks (github.com/xjasonlyu/tun2socks) creates a TUN virtual network interface
and forwards all traffic through it to a SOCKS5 proxy. Apps see a normal network
interface — they have no idea a proxy is involved.

### Why This Is Better Than System Proxy Settings

| | GNOME/System Proxy | tun2socks |
|---|---|---|
| Coverage | Proxy-aware apps only | Every app, every protocol |
| UDP | No | Yes |
| DNS leaks | Possible | Controlled |
| Per-app config | Sometimes needed | Never |
| Root required | No | Yes (TUN device) |
| apt, snap, docker | Don't use it | Just work |

System proxy settings are an application-layer hint — apps can ignore them, mishandle
them, or run as root without inheriting them. tun2socks operates at the OS network
layer — apps just have a normal internet connection and never make a proxy decision.

### How It Works

```
Linux app opens TCP socket to 1.1.1.1:443
    │
    kernel routes via tun0 (default route)
    │
tun2socks reads raw IP packets from tun0
    │
    reassembles into TCP stream
    │
    sends SOCKS5 CONNECT to 192.168.49.1:8282
    │
NetShare on Android opens socket to 1.1.1.1:443
    │
    response comes back same path in reverse
    │
tun2socks writes response packets back into tun0
    │
kernel delivers to the app
```

The app's socket call completes normally. Zero proxy awareness required.

### Installation

```bash
# download prebuilt binary (check arch with: uname -m)
wget https://github.com/xjasonlyu/tun2socks/releases/latest/download/tun2socks-linux-amd64.zip
unzip tun2socks-linux-amd64.zip
chmod +x tun2socks
sudo mv tun2socks /usr/local/bin/

# verify TUN support (present on all mainstream kernels)
ls /dev/net/tun
```

---

## 16. Routing, Metrics, and the Default Route Problem

### What a Metric Is

Metric is a **route priority number**. When the kernel has multiple routes that could
handle a packet, it picks the one with the lowest metric. Lower = preferred.

```
default via 192.168.49.1 dev wlp0s20f3              ← metric 0, wins
default via 198.18.0.1   dev tun0       metric 1    ← loses to metric 0
default via 192.168.49.1 dev wlp0s20f3  metric 600  ← fallback only
```

Metric does not load-balance. The kernel picks one route and ignores the rest.
Higher-metric routes only activate if lower ones disappear — making them fallbacks.

### The Default Route Problem with NetShare

When your Linux machine connects to NetShare's WiFi Direct network, the DHCP client
(NetworkManager/dhclient) receives a default route from NetShare's DHCP server and
installs it at metric 0. A manually added tun0 route at metric 1 then loses —
all traffic goes directly out via `wlp0s20f3` to Android's gateway, bypassing
tun2socks entirely.

The fix: flush all default routes before adding the tun0 one:

```bash
# remove all default routes regardless of metric/proto
while ip route del default 2>/dev/null; do :; done

# add tun0 as sole default route
ip route add default via 198.18.0.1 dev tun0 metric 1
```

### The Anti-Loop Route

tun2socks needs to send packets to the SOCKS5 proxy at 192.168.49.1. If all traffic
goes via tun0, those proxy packets also go via tun0 → tun2socks → tries to reach
proxy via tun0 → infinite loop.

Fix: add a host route keeping the Android IP reachable directly:

```bash
ip route replace 192.168.49.1/32 dev wlp0s20f3
```

This must be added before the default route change. Traffic to 192.168.49.1 takes
this specific host route; everything else takes the tun0 default.

### Route Decision Precedence

The kernel always prefers more specific routes over less specific ones, regardless
of metric:

```
192.168.49.1/32  dev wlp0s20f3    ← /32 = most specific, always wins for this IP
192.168.49.0/24  dev wlp0s20f3    ← subnet route
0.0.0.0/0        dev tun0         ← default, least specific, catches everything else
```

---

## 17. DNS Handling

### The Problem

With tun0 as the default route, DNS queries from systemd-resolved go via tun0 →
tun2socks → SOCKS5 proxy. This works only if the SOCKS5 proxy handles UDP correctly
(SOCKS5 UDP ASSOCIATE). NetShare may or may not implement this.

### The Fix

Point systemd-resolved at a public DNS server via the tun0 interface:

```bash
resolvectl dns tun0 1.1.1.1 8.8.8.8
resolvectl domain tun0 "~."   # use this interface for all domains
```

The `~.` domain means "this is the default DNS interface for all queries." DNS queries
go to 1.1.1.1 over TCP (tun2socks handles TCP cleanly), bypassing UDP ASSOCIATE.

### SOCKS5 DNS Modes

When configuring SOCKS5 manually for apps that don't go through tun2socks:

- `socks5://` — the app resolves DNS locally, sends the IP to the proxy. Fails if
  you have no direct internet route for DNS.
- `socks5h://` — the app sends the hostname to the proxy, proxy resolves it. Always
  use this when the only internet path is through the proxy.

---

## 18. Per-App Proxy Behaviour on Linux

System proxy settings (GNOME/KDE) are not universally respected. Each app has its
own story:

| App | Proxy behaviour | Fix |
|---|---|---|
| Firefox | Respects GNOME proxy or its own settings | Set in about:preferences or use PAC URL |
| Chrome | Respects GNOME proxy | Works automatically |
| curl | Respects `http_proxy` env var | `export https_proxy=socks5h://...` |
| wget | Respects `http_proxy` env var | Same as curl |
| apt | Ignores everything, reads own config | `/etc/apt/apt.conf.d/99proxy` |
| snap | Ignores GNOME, reads snapd config | `sudo snap set system proxy.https=...` |
| flatpak | Respects env vars | `export https_proxy=...` |
| docker pull | Ignores everything, reads systemd env | `/etc/systemd/system/docker.service.d/proxy.conf` |
| ssh | Ignores proxy settings | `ProxyCommand nc -X 5 -x host:port %h %p` in `~/.ssh/config` |
| pip | Respects `--proxy` flag or env var | `pip install x --proxy socks5h://...` |
| ping | Cannot be proxied | Just won't work through SOCKS5 |

**apt config** (`/etc/apt/apt.conf.d/99proxy`):
```
Acquire::http::Proxy "socks5h://192.168.49.1:8282";
Acquire::https::Proxy "socks5h://192.168.49.1:8282";
```

apt runs as root and doesn't inherit user session proxy settings. The `h` in
`socks5h` is critical — apt sends hostnames to the proxy for resolution rather
than resolving locally (which would fail with no direct internet route).

tun2socks eliminates all of the above by making the proxy transparent at the OS
network layer. None of these per-app configs are needed when tun2socks is running.

---

## 19. Setup Scripts

### tun2socks-up

```bash
#!/bin/bash
# Usage: sudo tun2socks-up [android-ip] [socks-port]
# Defaults: 192.168.49.1  8282

ANDROID_IP="${1:-192.168.49.1}"
SOCKS_PORT="${2:-8282}"
TUN_DEV="tun0"
TUN_ADDR="198.18.0.1"
PIDFILE="/var/run/tun2socks.pid"
LOGFILE="/var/log/tun2socks.log"

# detect hotspot interface
HOTSPOT_IFACE=$(ip route get "$ANDROID_IP" | awk '/dev/{print $3; exit}')

# save state for down script
echo "ORIG_GW=$(ip route show default | awk '/default/{print $3; exit}')" > /var/run/tun2socks.env
echo "ORIG_IFACE=$(ip route show default | awk '/default/{print $5; exit}')" >> /var/run/tun2socks.env
echo "HOTSPOT_IFACE=$HOTSPOT_IFACE" >> /var/run/tun2socks.env
echo "ANDROID_IP=$ANDROID_IP"       >> /var/run/tun2socks.env
echo "TUN_DEV=$TUN_DEV"             >> /var/run/tun2socks.env

# create tun interface
ip tuntap add dev "$TUN_DEV" mode tun
ip addr add "$TUN_ADDR/15" dev "$TUN_DEV"
ip link set dev "$TUN_DEV" up

# start tun2socks
tun2socks --device "$TUN_DEV" \
          --proxy "socks5://$ANDROID_IP:$SOCKS_PORT" \
          --loglevel warning >> "$LOGFILE" 2>&1 &
echo $! > "$PIDFILE"

sleep 1

# anti-loop: keep android ip reachable directly
ip route replace "$ANDROID_IP/32" dev "$HOTSPOT_IFACE"

# flush all default routes (DHCP from netshare injects one at metric 0)
while ip route del default 2>/dev/null; do :; done

# tun0 is now sole default route
ip route add default via "$TUN_ADDR" dev "$TUN_DEV" metric 1

# DNS
resolvectl dns "$TUN_DEV" 1.1.1.1 8.8.8.8
resolvectl domain "$TUN_DEV" "~."
```

### tun2socks-down

```bash
#!/bin/bash
source /var/run/tun2socks.env

kill $(cat /var/run/tun2socks.pid)

ip route del default dev "$TUN_DEV"    2>/dev/null || true
ip route del "$ANDROID_IP/32"          2>/dev/null || true
ip link set dev "$TUN_DEV" down
ip link del "$TUN_DEV"

# restore original default route if there was one
[[ -n "$ORIG_GW" ]] && ip route replace default via "$ORIG_GW" dev "$ORIG_IFACE"

resolvectl revert "$TUN_DEV" 2>/dev/null || true

rm -f /var/run/tun2socks.pid /var/run/tun2socks.env
```

### Install

```bash
sudo cp tun2socks-up tun2socks-down /usr/local/bin/
sudo chmod +x /usr/local/bin/tun2socks-up /usr/local/bin/tun2socks-down
```

### Verify

```bash
sudo tun2socks-up
curl https://ifconfig.me        # should return an IP
sudo apt update                 # works without extra config
sudo tun2socks-down
```

---

*Document covers: 5G/4G carrier architecture, tethering detection, Android tethering
subsystem, bearer/QoS/APN concepts, fwmark, WiFi Direct, NetShare, tun2socks,
Linux routing/metrics, DNS, and per-app proxy behaviour.*
