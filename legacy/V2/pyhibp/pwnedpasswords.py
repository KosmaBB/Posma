import hashlib

import requests

from pyhibp import _require_user_agent, pyHIBP_HEADERS

PWNED_PASSWORDS_API_BASE_URI = "https://api.pwnedpasswords.com/"
PWNED_PASSWORDS_API_ENDPOINT_RANGE_SEARCH = "range/"

RESPONSE_ENCODING = "utf-8-sig"


def is_password_breached(password: str = None, sha1_hash: str = None, add_padding: bool = False, timeout=5.0) -> int:
    """
    Execute a search for a password via the k-anonymity model, checking for hashes which match a specified
    prefix instead of supplying the full hash to the Pwned Passwords API.

    Uses the first five characters of a SHA-1 hash to provide a list of hash suffixes along with the
    number of times that hash appears in the data set. In doing so, the API is not provided the information
    required to reconstruct the password (e.g., by brute-forcing the hash).

    Either ```password`` or ``sha1_hash`` must be specified. Only one parameter should be provided.

    The precedence of parameters is as follows:
    1) password - Used to compute the SHA-1 hash of the password.
    2) sha1_hash - The hash prefix (hash[0:5]) is passed to the HIBP API, and this function will check the returned list of
    hash suffixes to determine if a breached password was in the HIBP database.

    :param password: The password to check. Will be converted to a SHA-1 string. `str` type.
    :param sha1_hash: A full SHA-1 hash. `str` type.
    :param add_padding: Whether padding should be used when performing the check (obfuscates response size, does not
    alter return type/value.
    :param timeout: The timeout value to be passed to the underlying `requests.get()` call. Default 5.0.
    :return: An Integer representing the number of times the password is in the data set; if not found,
    Integer zero (0) is returned.
    :rtype: int
    """
    # Parameter validation section
    if not any([password, sha1_hash]):
        raise AttributeError("Either password or sha1_hash must be provided.")
    elif password is not None and not isinstance(password, str):
        raise AttributeError("password must be a string.")
    elif sha1_hash is not None and not isinstance(sha1_hash, str):
        raise AttributeError("sha1_hash must be a string.")

    if password:
        sha1_hash = hashlib.sha1(password.encode('utf-8')).hexdigest()
    if sha1_hash:
        # The HIBP API stores the SHA-1 hashes in uppercase, so ensure we have it as uppercase here
        sha1_hash = sha1_hash.upper()
        hash_prefix = sha1_hash[0:5]

    suffix_list = suffix_search(hash_prefix=hash_prefix, add_padding=add_padding, timeout=timeout)

    # Since the full SHA-1 hash was provided, check to see if it was in the resultant hash suffixes returned.
    for hash_suffix in suffix_list:
        if sha1_hash[5:] in hash_suffix:
            # We found the full hash, so return
            return int(hash_suffix.split(':')[1])

    # If we get here, there was no match to the supplied SHA-1 hash; return zero.
    return 0


@_require_user_agent
def suffix_search(hash_prefix: str = None, add_padding: bool = False, timeout=5.0) -> list:
    """
    Returns a list of SHA-1 hash suffixes, consisting of the SHA-1 hash characters after position five,
    and the number of times that password hash was found in the HIBP database, colon separated.

    Leveraging the k-Anonymity model, a list of hashes matching a specified SHA-1 prefix are returned.
    From this list, the calling application may determine if a given password was breached by comparing
    the remainder of the SHA-1 hash against the returned results. As an example, for the hash prefix of
    '42042', the hash suffixes would be:

    ```
    005F4A4B9265A2BABE10B1A9AB9409EA3F0:1
    00D6F0319225107BD5736B72717BD381660:8
    01355DCE0B54F0E8DBBBA8F7B9A9872858A:15
    0163E1C872A64A62625F5EB2F3807B7F90B:2
    020DDE278E6A9C05B356C929F254CE6AED5:1
    021EFB4FAE348050D9EDCD10F8B6A87C957:4
    ...
    ```

    If the `prefix` and `suffix` form a complete SHA-1 hash for the password being compared, then it
    indicates the password has been found in the HIBP database.

    :param add_padding: Boolean. Adds padding to the response to include hash suffixes which have not been breached, in
    order to prevent sniffing of response size to infer what hash prefix was searched. Entries which end in zero can be
    disregarded.
    :param hash_prefix: The first five characters of a SHA-1 hash. `str` type.
    :param timeout: The timeout value to be passed to the underlying `requests.get()` call. Default 5.0.
    :return: A list of hash suffixes.
    :rtype: list
    """
    if not hash_prefix or not isinstance(hash_prefix, str):
        raise AttributeError("hash_prefix must be a supplied, and be a string.")
    if hash_prefix and len(hash_prefix) != 5:
        raise AttributeError("hash_prefix must be of length 5.")

    uri = PWNED_PASSWORDS_API_BASE_URI + PWNED_PASSWORDS_API_ENDPOINT_RANGE_SEARCH + hash_prefix

    _headers = pyHIBP_HEADERS
    _headers['Add-Padding'] = "true" if add_padding else None

    resp = requests.get(url=uri, headers=_headers, timeout=timeout)
    if resp.status_code != 200:
        # The HTTP Status should always be 200 for this request
        raise RuntimeError("Response from the endpoint was not HTTP200; this should not happen. Code was: {0}".format(resp.status_code))
    # The server response will have a BOM if we don't do this.
    resp.encoding = RESPONSE_ENCODING

    return resp.text.split()
