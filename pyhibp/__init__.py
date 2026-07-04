import requests


HIBP_API_BASE_URI = "https://haveibeenpwned.com/api/v3/"
HIBP_API_ENDPOINT_BREACH_SINGLE = "breach/"
HIBP_API_ENDPOINT_BREACHES = "breaches"
HIBP_API_ENDPOINT_BREACHED_ACCT = "breachedaccount/"
HIBP_API_ENDPOINT_DATA_CLASSES = "dataclasses"
HIBP_API_ENDPOINT_PASTES = "pasteaccount/"


# The headers we send along with each request
pyHIBP_HEADERS = {
    'User-Agent': None,
    'hibp-api-key': None
}


def _require_user_agent(function):
    """
    A decorator which enforces setting the User-Agent on each request. As per the HIBP API, the UA must be set, or a
    HTTP 403 response wil; be raised.

    :raises: RuntimeError if the application User-Agent is not set via ``set_user_agent()`` prior to invoking functions
    which communicate with the HIBP or PwnedPasswords APIs.
    """
    def inner(*args, **kwargs):
        if pyHIBP_HEADERS.get("User-Agent") is None:
            raise RuntimeError("The User-Agent must be set. Call pyhibp.set_user_agent(ua=your_agent_string) first.")
        return function(*args, **kwargs)
    return inner


def set_user_agent(ua: str = None):
    """
    Sets the User-Agent to be used in subsequent calls sent to the HIBP API backend. The UA set should be the name of the
    application implementing the pyhibp module, and accurately describe the nature of the API consumer.

    See: https://haveibeenpwned.com/API/v3#UserAgent

    The HIBP API enforces setting a User-Agent, otherwise an HTTP 403 will be returned.

    :param ua: A string representing the application name which is implementing the pyhibp module which is sent with
    each request to the HIBP API.
    """
    pyHIBP_HEADERS['User-Agent'] = ua


def _require_api_key(function):
    """
    A decorator which enforces setting an API key on functions which require one to be set. Not setting an API key would
    result in an HTTP 401 Unauthorised.

    :raises: RuntimeError if the API key for enabling searching the HIBP API backend by account (email) is not set prior
    to calling functions which invoke said capability.
    """
    def inner(*args, **kwargs):
        if pyHIBP_HEADERS.get('hibp-api-key') is None:
            raise RuntimeError("A HIBP API key is required for this call. Call pyhibp.set_api_key(key=your_key) first.")
        return function(*args, **kwargs)
    return inner


def set_api_key(key: str = None):
    """
    Set an API key for use in all future calls to the pyhibp module which search the HIBP database by email address.

    Per the HIBP API documentation: "Authorisation is required for all APIs that enable searching HIBP by email address,
    namely retrieving all breaches for an account and retrieving all pastes for an account."

    A key can be purchased from <https://haveibeenpwned.com/API/Key>.

    :param key: The key to set for each subsequent request where it is required.
    """
    pyHIBP_HEADERS['hibp-api-key'] = key


def _process_response(response) -> bool:
    """
    Process the `requests` response from the call to the HIBP API endpoints.

    :param response: The response object from a call to `requests`
    :return: True if HTTP Status 200, False if 404. Raises RuntimeError on API-defined status codes of
    400, 403, 429; NotImplementedError if the API returns an unexpected HTTP status code.
    :rtype: bool
    """
    if response.status_code == 200:
        # The request was successful (we found an item)
        return True
    elif response.status_code == 404:
        # The request was successful, though the item wasn't found
        return False
    elif response.status_code == 400:
        # Bad request - The account does not comply with an acceptable format (i.e., it's an empty string)
        raise RuntimeError(
            "HTTP 400 - Bad request - The account does not comply with an acceptable format (i.e., it's an empty string).")
    elif response.status_code == 401:
        # Unauthorised - the API key provided was not valid
        raise RuntimeError(
            "HTTP 401 - Unauthorised - The API key provided was not valid."
        )
    elif response.status_code == 403:
        # Forbidden - no user agent has been specified in the request
        raise RuntimeError("HTTP 403 - User agent required for HIBP API requests, but no user agent was sent to the API endpoint.")
    elif response.status_code == 429:
        # Too many requests - the rate limit has been exceeded
        raise RuntimeError(
            "HTTP 429 - Rate limit exceeded: API rate limit is 1500ms. Retry-After header was: {0}".format(response.headers['Retry-After'])
        )
    else:
        # We /should/ get one of the above error codes. If not, raise an error.
        raise NotImplementedError("Returned HTTP status code of {0} was not expected.".format(response.status_code))


@_require_api_key
@_require_user_agent
def get_account_breaches(
        account: str = None,
        domain: str = None,
        truncate_response: bool = False,
        include_unverified: bool = False,
        timeout=5.0) -> list:
    """
    Gets breaches for a specified account from the HIBP system, optionally restricting the returned results
    to a specified domain.

    This function requires a HIBP API key to be set. See ``set_api_key()``.

    :param account: The user's account name (such as an email address or a user-name). Default None. `str` type. Required.
    :param domain: The domain to check for breaches. Default None. `str` type. Optional
    :param truncate_response: If ``account`` is specified, truncates the response down to the breach names.
    Default False. `bool` type.
    :param include_unverified: If set to True, unverified breaches are included in the result. Default False. `bool` type
    :param timeout: The timeout value to be passed to the underlying `requests.get()` call. Default 5.0.
    :return: A list object containing one or more dict objects, based on the information being requested,
    provided there was matching information. Boolean False returned if no information was found according to
    the HIBP API.
    :rtype: list
    """
    if account is None or not isinstance(account, str):
        raise AttributeError("The account parameter must be specified, and must be a string.")
    # The domain does not need to specified, but is must be text, if so.
    if domain is not None and not isinstance(domain, str):
        raise AttributeError("The domain parameter, if specified, must be a string.")

    uri = HIBP_API_BASE_URI + HIBP_API_ENDPOINT_BREACHED_ACCT + account

    # Build the query string payload (requests drops params when None)
    # (and the HIBP backend ignores those that don't apply)
    query_string_payload = {
        "domain": domain,
        "truncateResponse": truncate_response,
        "includeUnverified": include_unverified,
    }
    resp = requests.get(url=uri, params=query_string_payload, headers=pyHIBP_HEADERS, timeout=timeout)

    if _process_response(response=resp):
        return resp.json()
    else:
        return []


@_require_user_agent
def get_all_breaches(domain: str = None, timeout=5.0) -> list:
    """
    Returns a listing of all sites breached in the HIBP database.

    :param domain: Optional, default None. If specified, get all breaches for the domain with the specified name. `str` type.
    :return: A list object containing one or more dict objects if breaches are present. Returns Boolean False.
    :param timeout: The timeout value to be passed to the underlying `requests.get()` call. Default 5.0.
    if ``domain`` is specified, but the resultant list would be length zero.
    :rtype: list
    """
    if domain is not None and not isinstance(domain, str):
        raise AttributeError("The domain parameter, if specified, must be a string.")

    uri = HIBP_API_BASE_URI + HIBP_API_ENDPOINT_BREACHES
    query_string_payload = {'domain': domain}
    resp = requests.get(url=uri, params=query_string_payload, headers=pyHIBP_HEADERS, timeout=timeout)

    # The API will return HTTP200 even if resp.json is length zero.
    if _process_response(response=resp) and len(resp.json()) > 0:
        return resp.json()
    else:
        return []


@_require_user_agent
def get_single_breach(breach_name: str = None, timeout=5.0) -> dict:
    """
    Returns a single breach's information from the HIBP's database.

    :param breach_name: The breach to retrieve. Required. `str` type.
    :param timeout: The timeout value to be passed to the underlying `requests.get()` call. Default 5.0.
    :return: A dict object containing the information for the specified breach name, if it exists in the HIBP
    database. Boolean False is returned if the specified breach was not found.
    :rtype: dict
    """
    if not isinstance(breach_name, str):
        raise AttributeError("The breach_name must be specified, and be a string.")

    uri = HIBP_API_BASE_URI + HIBP_API_ENDPOINT_BREACH_SINGLE + breach_name
    resp = requests.get(url=uri, headers=pyHIBP_HEADERS, timeout=timeout)

    if _process_response(response=resp):
        return resp.json()
    else:
        return {}


@_require_api_key
@_require_user_agent
def get_pastes(email_address: str = None, timeout=5.0) -> list:
    """
    Retrieve all pastes for a specified email address.

    This function requires a HIBP API key to be set. See ``set_api_key()``.

    :param email_address: The email address to search. Required. `str` type.
    :param timeout: The timeout value to be passed to the underlying `requests.get()` call. Default 5.0.
    :return: A list object containing one or more dict objects corresponding to the pastes the specified email
    address was found in. Boolean False returned if no pastes are detected for the given account.
    :rtype: list
    """
    if not isinstance(email_address, str):
        raise AttributeError("The email address supplied must be provided, and be a string.")

    uri = HIBP_API_BASE_URI + HIBP_API_ENDPOINT_PASTES + email_address
    resp = requests.get(url=uri, headers=pyHIBP_HEADERS, timeout=timeout)

    if _process_response(response=resp):
        return resp.json()
    else:
        return []


@_require_user_agent
def get_data_classes(timeout=5.0) -> list:
    """
    Retrieves all available data classes from the HIBP API.

    :param timeout: The timeout value to be passed to the underlying `requests.get()` call. Default 5.0.
    :return: A list object containing available data classes, corresponding to attributes found in breaches.
    A given breach will have one or more of the data classes in the list.
    :rtype: list
    """
    uri = HIBP_API_BASE_URI + HIBP_API_ENDPOINT_DATA_CLASSES
    resp = requests.get(url=uri, headers=pyHIBP_HEADERS, timeout=timeout)

    if _process_response(response=resp):
        return resp.json()
    else:
        # This path really shouldn't return false
        raise RuntimeError("HIBP API returned HTTP404 on a request for data classes.")
