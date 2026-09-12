package ai.coderclaw.android.gateway

/**
 * DNS-SD service types a gateway can advertise, current first. The runtime advertises
 * `_builderforce-gw._tcp`; older runtimes advertise the pre-rebrand type, so discovery
 * browses both. This is the one list for Android.
 */
object GatewayServiceTypes {
  val all: List<String> = listOf("_builderforce-gw._tcp.", "_coderclaw-gw._tcp.")

  /** NSD reports types with or without the surrounding dots; compare on one canonical form. */
  fun canonical(serviceType: String): String {
    val trimmed = serviceType.trim().trimStart('.').lowercase()
    return if (trimmed.endsWith(".")) trimmed else "$trimmed."
  }

  /** The browsed type that [serviceType] names, or null when it is not a gateway type. */
  fun match(serviceType: String): String? {
    val wanted = canonical(serviceType)
    return all.firstOrNull { it == wanted }
  }

  /** Strips the `<type><domain>` suffix from a wide-area instance FQDN, whichever gateway type it names. */
  fun instanceLabel(instanceFqdn: String, domain: String): String {
    for (type in all) {
      val suffix = "$type$domain"
      if (instanceFqdn.endsWith(suffix)) return instanceFqdn.removeSuffix(suffix)
    }
    for (type in all) {
      if (instanceFqdn.contains(type)) return instanceFqdn.substringBefore(type)
    }
    return instanceFqdn
  }
}
