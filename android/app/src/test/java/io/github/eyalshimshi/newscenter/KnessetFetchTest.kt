package io.github.eyalshimshi.newscenter

import io.github.eyalshimshi.newscenter.data.BLOCKED_DOMAINS
import io.github.eyalshimshi.newscenter.data.KnessetFetch
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class KnessetFetchTest {

    @Test
    fun theKnessetServicesAreAllowed() {
        assertTrue(KnessetFetch.isAllowed("https://knesset.gov.il/OdataV4/ParliamentInfo/KNS_KnessetDates?\$filter=IsCurrent%20eq%20true"))
        assertTrue(KnessetFetch.isAllowed("https://knesset.gov.il/WebSiteApi/knessetapi/MkLobby/GetMkLobbyData120?lang=he"))
        assertTrue(KnessetFetch.isAllowed("https://main.knesset.gov.il/apps/committees"))
    }

    @Test
    fun otherSitesAndPlainHttpAreRefused() {
        assertFalse(KnessetFetch.isAllowed("http://knesset.gov.il/OdataV4/ParliamentInfo/KNS_Bill"))
        assertFalse(KnessetFetch.isAllowed("https://example.com/?u=https://knesset.gov.il/"))
        assertFalse(KnessetFetch.isAllowed("https://knesset.gov.il.example.com/"))
        assertFalse(KnessetFetch.isAllowed("https://notknesset.gov.il/"))
        assertFalse(KnessetFetch.isAllowed("https://${BLOCKED_DOMAINS.first()}/"))
        assertFalse(KnessetFetch.isAllowed("file:///data/data/x"))
        assertFalse(KnessetFetch.isAllowed(""))
    }

    @Test
    fun repliesKeepStatusesAWebViewAccepts() {
        assertEquals(200, KnessetFetch.pageStatus(200))
        assertEquals(247, KnessetFetch.pageStatus(247))
        assertEquals(473, KnessetFetch.pageStatus(473))
        assertEquals(502, KnessetFetch.pageStatus(302))
        assertEquals(502, KnessetFetch.pageStatus(0))
        assertEquals(502, KnessetFetch.pageStatus(600))
    }
}
