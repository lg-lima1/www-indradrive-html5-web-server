/*****************************************************************************
 *                         Copyright (c) 2014 by
 *                             Bosch Rexroth
 *                          All Rights Reserved
 *
 * File:	 ComLib.js
 * Version:  1.0.0
 *
 *****************************************************************************/

/*************************************************************************************************
 * CONSTRUCTOR
 * COMMENT : HTTP Request Object
 * INPUT   : -
 * OUTPUT  : -
 **************************************************************************************************/
function Http()
{
    this.sTypeOf = 'Http';
    this.oCGI = null;       // Currently active CGI scripting object
    this.xmlhttp = null;    // HTTP request object
    this.oTimer = null;     // asynchronous timeout
    this.bAbort = false;    // set true if the transaction is aborted
    this.nXactId = 0;       // transaction id (used for trace monitor)
    this.bActive = false;   // true if the object is processing a request
    this.aRead = [];        //array of pending COM_Obj objects
    this.aWrite = [];       //array of pending COM_Obj objects
    this.iRetryTimer_ms = 100;   //Defdb00143532: XLC/MLC: IMST-Popup Fenster bei Verbindungsabbruch
    this.oRetryTimer = null;   //Defdb00143532: XLC/MLC: IMST-Popup Fenster bei Verbindungsabbruch

    // Create the HTTP object
    if (window.XMLHttpRequest)
    {
        this.xmlhttp = new XMLHttpRequest();
    }
    else if (window.ActiveXObject)
    {
        try
        {
            this.xmlhttp = new ActiveXObject("Microsoft.XMLHTTP");
        }
        catch (e)
        {
            this.xmlhttp = null;
            alert("Http::Constructor: " + e.message);
        }
    }

    /*************************************************************************************************
    * FUNCTION: fnAsyncTimeout
    * COMMENT : Faengt asynchrone Timeouts ab und triggert ein asynchrones Lesen nach einem synchronen Lesen
    * INPUT   : -
    * OUTPUT  : -
    **************************************************************************************************/
    this.fnAsyncTimeout = function (oHttp)
    {
        var sText;

        if (!oHttp || !oHttp.oTimer) { return; } // object is invalid

        try
        {
            clearTimeout(oHttp.oTimer); //Defdb00143532
            oHttp.bAbort = true;

            if (oHttp.xmlhttp.readyState != 4)
            {
                oHttp.xmlhttp.abort(); // abort the HTTP transaction
            }
            if (oHttp.oCGI.nAsyncRetry-- > 0)
            {
                oHttp.fnHttpRetry(true);
            }
        }
        catch (e)
        {

        }
    };

    /*************************************************************************************************
     * FUNCTION: fnGetHttpRequestErrorText
     * COMMENT : Hilfsfunktion, die die Fehlermeldungen liefert
     * INPUT   : HTTP Request Object
     * OUTPUT  : Fehlertext
    **************************************************************************************************/
    this.fnGetHttpRequestErrorText = function (oXMLHttpRequest)
    {
        var sText = "";

        switch (oXMLHttpRequest.status)
        {
            case 400:
                sText = "Bad Request Format!";
                break;
            case 500:
                sText = "Internal Server Error!";
                break;
            case 12002:
                sText = "The WEB server is not responding!";
                break;
            case 12150:
                sText = "The requested header could not be located!";
                break;
            case 12151:
                sText = "The server did not return any headers!";
                break;
            case 12152:
                sText = "The server response could not be parsed!";
                break;
            case 12153:
                sText = "The supplied header is invalid!";
                break;
            default:
                if (oXMLHttpRequest.statusText)
                {
                    sText = oXMLHttpRequest.status.toString() + ": " + oXMLHttpRequest.statusText;
                }
                else
                {
                    sText = oXMLHttpRequest.status.toString() + ": ";
                    sText += "Unknown HTTP error!";
                }
                break;
        }
        return sText;
    };

    /*************************************************************************************************
     * FUNCTION: fnHttpOnChange_asynch
     * COMMENT : HTTP Callback Funktion, verwendet das globale Objekt
     * INPUT   : -
     * OUTPUT  : -
      **************************************************************************************************/
    this.fnHttpOnChange_asynch = function ()
    {
        var sResponse, oCGI, oHttp = window.top.document.oWS.oHttp;
        var bRetry = false;

        if (!oHttp.bAbort && oHttp.xmlhttp.readyState == 4)
        {
            // Kill the asynchronous message timer
            if (oHttp.oTimer)
            {
                clearTimeout(oHttp.oTimer); // stop the communication timeout
                oHttp.oTimer = null;
            }
            // Is there a valid response?
            if (oHttp.xmlhttp.status == 200 || oHttp.xmlhttp.status == 304)
            {
                sResponse = oHttp.xmlhttp.responseText;
                oCGI = oHttp.oCGI;

                // validate the response and invoke the callback
                bRetry = oCGI.fnParseResponse(sResponse); //Defdb00143532
                if (bRetry || oCGI.fnInvokeCallback())
                {
                    //Defdb00143532
                    oHttp.fnHttpRetry(false); // for MLD without SetTimeOut
                }
                else
                {
                    oHttp.fnSend();
                } // send the next request before exiting
            }
            else if (oHttp.xmlhttp.status == 500) //Server busy - give the server a rest!
            {
                oHttp.oTimer = window.top.setTimeout(function () { oHttp.fnAsyncTimeout(oHttp); }, 500);// msg retry will resend request
            }
            else if (oHttp.xmlhttp.status == 404)
            {
                // FEAT-00024347
                sResponse = "An asynchronous communication request has timed out.";
                window.alert(sResponse);
            }
            else // handle HTTP errors
            {
                sResponse = oHttp.fnGetHttpRequestErrorText(oHttp.xmlhttp);
                alert(sResponse);
            }// end HTTP error
        }// end readyState == 4
    };
}

/*************************************************************************************************
 * FUNCTION: fnRead
 * COMMENT : Sendet einen HTTP Request
 * INPUT   : oCGI - CGI Script Interface Object
 * OUTPUT  : -
 **************************************************************************************************/
Http.prototype.fnRead = function (oCGI)
{
    this.aRead[this.aRead.length] = oCGI; // place object in the 'read' queue (lower priority)

    if (!this.bActive)
    {
        this.fnSend();
    }
};

/*************************************************************************************************
 * FUNCTION: fnWrite
 * COMMENT : Sendet einen HTTP POST Request
 * INPUT   : oCGI - CGI Script Interface Object
 * OUTPUT  : -
 **************************************************************************************************/
Http.prototype.fnWrite = function (oCGI)
{
    this.aWrite[this.aWrite.length] = oCGI; // place object in queue

    if (!this.bActive)
    {
        this.fnSend();
    } // if we are not busy then send the request
};

/*************************************************************************************************
 * FUNCTION: fnSend
 * COMMENT : Sendet einen HTTP Request an den Server
 * INPUT   : oCGI - CGI Script Interface Object
 * OUTPUT  : -
 **************************************************************************************************/
Http.prototype.fnSend = function (oCGI)
{
    var bAsync, sResponse;

    this.bActive = true; // communication engine is active!
    // If no object was passed then remove one from the queue
    if (!oCGI)
    {
        if (this.aWrite.length)
        {
            oCGI = this.aWrite.shift();
        }
        else if (this.aRead.length)
        {
            oCGI = this.aRead.shift();
        }
        else
        {
            this.bActive = false;
            return;
        } // no more transactions so go to sleep!
    }
    // Initialize the object
    bAsync = true;
    oCGI.sResponse = ""; // clear the response buffer
    this.oCGI = oCGI; // assign the transaction specific object
    this.bAbort = false; // set true if the transaction is aborted
    this.nXactId++; // unique transaction id/counter
    this.xmlhttp.open(oCGI.HTTP_Type, oCGI.sRequest, bAsync);
    this.xmlhttp.onreadystatechange = this.fnHttpOnChange_asynch;
    try
    {
        if (oCGI.HTTP_Type === "GET")
        {
            if (window.ActiveXObject)
            {
                // Datum muss gesetzt werden, sonst wird im IE bei der MLD die cgi-Anfrage gecacht! Bei der MLC erlaubt der Webserver ein cgi-Caching nicht!
                this.xmlhttp.setRequestHeader('If-Modified-Since', 'Sat, 1 Jan 2000 00:00:00 GMT');

                //Hier kommt es im IE 9 und IE10 zu Problemen, weil diese Properties nicht vorhanden sind - deshalb try catch 
                try
                {
                    if (this.xmlhttp.responseXML && this.xmlhttp.responseXML.preserveWhiteSpace)
                    {
                        this.xmlhttp.responseXML.preserveWhiteSpace = true;
                    }
                }
                catch (e)
                {

                }
            }

            if (window.XMLHttpRequest)
            {
                if (typeof this.xmlhttp.msCaching != "undefined")
                {
                    // Defdb00172860: caching der cgi-Requests im IE11 verhindern
                    this.xmlhttp.msCaching = "disabled";
                }

                this.xmlhttp.send(null);
            }  // non-IE browsers
            else if (window.ActiveXObject)
            {
                this.xmlhttp.send();
            } // InternetExplorer
        }
        else    // use POST
        {
            this.xmlhttp.setRequestHeader("Content-type", "text/plain");
            this.xmlhttp.send(oCGI.sContent);
        }
    }
    catch (e)
    {
        this.bActive = false;
        return false;
    }
    // Message was sent - handle results  
    //asynchronous transaction - start the response timer	
    var oInst = this; // save in a local instance or the callback does not get correct object instance
    this.oTimer = window.top.setTimeout(function () { oInst.fnAsyncTimeout(oInst); }, oCGI.nAsyncTimeout_ms);
};

/*************************************************************************************************
 * FUNCTION: fnHttpRetry
 * COMMENT : Wiederholt den HTTP Request
 * INPUT   : -
 * OUTPUT  : -
  **************************************************************************************************/
Http.prototype.fnHttpRetry = function (bRetry)
{
    var isRetry = false;
    if (bRetry)
    {
        isRetry = bRetry;
    }
    // stop the communication timer if it is running
    if (this.oTimer)
    {
        window.clearTimeout(this.oTimer); // stop the communication timeout
        this.oTimer = null;
    }

    //// Resend the request
    if (isRetry === false) // if modal dialog
    {
        return this.fnSend(this.oCGI);
    }

    var oInstance = this;

    oInstance.oRetryTimer = window.setTimeout(function ()
    {
        oInstance.fnHttpRetry(false);
    }, oInstance.iRetryTimer_ms);
};

/*************************************************************************************************
 * FUNCTION: fnHttpFlush
 * COMMENT : Stoppt die laufende Kommunikation
 * INPUT   : -
 * OUTPUT  : -
 **************************************************************************************************/
Http.prototype.fnHttpFlush = function ()
{
    this.bAbort = true;
    // stop the aynchronous timer
    if (this.oTimer)
    {
        clearTimeout(this.oTimer);
        this.oTimer = null;
    }
    // if we are in the middle of a transaction then abort it
    if (this.bActive && this.xmlhttp.readyState != 4)
    {
        this.xmlhttp.abort();
    }
    // empty the request queues
    this.aRead.length = 0;
    this.aWrite.length = 0;
    this.bActive = false;
};

/*************************************************************************************************
 * CONSTRUCTOR
 * COMMENT : WEB server communication interface class.
 * INPUT   : none 
 * OUTPUT  : none
 **************************************************************************************************/
function WebServerInterface()
{
    this.sTypeOf = 'WebServerInterface';
    this._bLoggedIn = false;
    this._sHomeURL = window.top.document.location.host;	// save the IP address
    this.sUser = "";
    this.oHttp = new Http();
    this.oCommand = { sIdent: "", sStatus: "" };

    window.top.document.oWS = this;
}

/*****************************************************************************
 * FUNCTION: fnLogin / cbLogin
 * INPUTS:   ComLib-Objekt
 * RETURN:   -
 * PURPOSE:  Zum Einloggen am Webserver
 ****************************************************************************/
WebServerInterface.prototype.fnLogin = function (oLogin)
{
    var bError = false, sErrorText = "";
    // Todo: abhaenigig, ob Passwort eingegeben werden muss, muss evtl. die MD5-Implementierung doch umgesetzt werden
    var sEncryptedPassword = "526545e524f08d95e0514ab5fe3aac46";

    // Login Objekt gueltig?
    if (typeof oLogin.callbackFunction == "undefined")
    {
        bError = true;
        sErrorText = "error: No callback function defined";
    }

    if (!bError)
    {
        oLogin.callbackData2 = this;
        oLogin.callbackFunction2 = this.cbLogin;
        oLogin.password = sEncryptedPassword;
        oLogin.user = "administrator";

        var oCGI = new COM_Login(oLogin);
        this.oHttp.fnWrite(oCGI); // asynchronous request
    }
    else
    {
        // ungueltiges Objekt
        fnCallBackInErrorCase(oLogin, sErrorText);
    }
};

WebServerInterface.prototype.cbLogin = function (sResponse, cbLogin, oCOM_Login)
{
    var oInst = oCOM_Login.oCbData2;
    if (sResponse === "ok")
    {
        oInst._bLoggedIn = true;
    }

    if (cbLogin)
    {
        oCOM_Login.oResponse = oCOM_Login.oRequest;
        oCOM_Login.oResponse.value = sResponse;
        cbLogin(oCOM_Login.oResponse);
    }
};

/*****************************************************************************
 * FUNCTION: fnLogOut/cbLogout
 * INPUTS:   ComLib-Objekt
 * RETURN:   none
 * PURPOSE:  Zum Ausloggen vom Webserver
 ****************************************************************************/
WebServerInterface.prototype.fnLogOut = function (oLogout)
{
    var oCGI, bError = false, sErrorText = "";

    if (this._bLoggedIn)
    {
        // Login Objekt gueltig?
        if (typeof oLogout.callbackFunction == "undefined")
        {
            sErrorText = "error: No callback function defined";
            bError = true;
        }

        if (!bError)
        {
            this.fnFlush();
            oCGI = new COM_Logout(oLogout); // Create request object
            this.oHttp.fnWrite(oCGI);       // asynchronous request  
            this._bLoggedIn = false;
            this.sUser = "";
        }
        else
        {
            // ungueltiges Objekt
            fnCallBackInErrorCase(oLogout, sErrorText);
        }
    }
    else
    {
        fnCallBackInErrorCase(oLogout, "Not logged on server!");
    }
};

WebServerInterface.prototype.cbLogout = function (sResponse)
{
};

/*****************************************************************************
 * FUNCTION: fnIsLoggedIn
 * INPUTS:   -
 * RETURN:   true/false
 * PURPOSE:  Gibt an, ob man am Webserver eingeloggt ist oder nicht
 ****************************************************************************/
WebServerInterface.prototype.fnIsLoggedIn = function ()
{
    return this._bLoggedIn;
};

/*****************************************************************************
 * FUNCTION: fnIsError
 * INPUTS:   Response vom Webserver
 * RETURN:   true/false
 * PURPOSE:  Bestimmt, ob der uebergebene Response ein Fehler ist oder nicht
 ****************************************************************************/
WebServerInterface.prototype.fnIsError = function (sResponse)
{
    var oCom = new COM_Obj();

    return oCom._fnIsError(sResponse); // bind the com class handler to the main class
};

/*****************************************************************************
 * FUNCTION: fnGetErrorMessage
 * INPUTS:   Fehlercode vom Webserver
 * RETURN:   Fehlertext
 * PURPOSE:  Liefert den Fehlertext fuer Webserver-Fehlercodes
 ****************************************************************************/
WebServerInterface.prototype.fnGetErrorMessage = function (sErrorCode)
{
    var oCom = new COM_Obj();

    return oCom._fnGetErrorMessage(sErrorCode); // bind the com class handler to the main class
};

/*************************************************************************************************
 * FUNCTION: fnFlush
 * COMMENT : Beendet alle laufenden Kommunikationsverbindungen
 * INPUT   : -
 * OUTPUT  : -
 **************************************************************************************************/
WebServerInterface.prototype.fnFlush = function ()
{
    this.oHttp.fnHttpFlush();
};

/********************************************************************************************
 * FUNCTION: fnReadParam
 * COMMENT : Liest Standard P- bzw. S-Parameter aus
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 **********************************************************************************************/
WebServerInterface.prototype.fnReadParam = function (oReadParam)
{
    var oCGI, sRc = "";

    if (this._bLoggedIn)
    {
        var oValidObject = fnValidServiceObject(oReadParam);

        if (oValidObject.isValidObject)
        {
            var oValidParams = fnValidateParameters(oReadParam);

            if (!oValidParams.areValidParameters)
            {
                // Parameter ungueltig
                fnCallBackInErrorCase(oReadParam, oValidParams.errorText);
                return sRc;
            }

            oCGI = new COM_GetVar(oReadParam);
            sRc = this.oHttp.fnRead(oCGI);
        }
        else
        {
            // Objekt ungueltig
            fnCallBackInErrorCase(oReadParam, oValidObject.errorText);
            return sRc;
        }
    }
    else
    {
        fnCallBackInErrorCase(oReadParam, "Not logged on server!");
    }

    return sRc;
};

/********************************************************************************************
 * FUNCTION: fnReadMldVar
 * COMMENT : Liest Standard MLD-Variablen bzw. mehrdimensionale MLD-Arrays aus
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 **********************************************************************************************/
WebServerInterface.prototype.fnReadMldVar = function (oReadMldVar)
{
    var oCGI, sRc = "", bError = false, sErrorText = "";

    if (this._bLoggedIn)
    {
        var oValidObject = fnValidServiceObject(oReadMldVar);

        if (oValidObject.isValidObject)
        {
            if (oReadMldVar.parameters.length > 0)
            {
                var oError = fnCheckMldVarIds(oReadMldVar);

                if (!oError.bMldVarIdsSpecified)
                {
                    bError = true;
                    sErrorText = oError.sErrorText;
                }
            }
            else
            {
                bError = true;
                sErrorText = "error: No parameters specified";
            }
        }
        else
        {
            bError = true;
            sErrorText = oValidObject.errorText;
        }

        if (bError)
        {
            fnCallBackInErrorCase(oReadMldVar, sErrorText);
            return sRc;
        }
        else
        {
            oCGI = new COM_GetMldVar(oReadMldVar);
            sRc = this.oHttp.fnRead(oCGI);
        }
    }
    else
    {
        fnCallBackInErrorCase(oReadMldVar, "Not logged on server!");
    }

    return sRc;
};

/********************************************************************************************
 * FUNCTION: fnReadListParam
 * COMMENT : Liest Standard S- und P-Listenparameter aus.
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 **********************************************************************************************/
WebServerInterface.prototype.fnReadListParam = function (oReadListParam)
{
    var oCGI, sRc = "", bError = false, sErrorText = "";

    if (this._bLoggedIn)
    {
        var oValidObject = fnValidServiceObject(oReadListParam);

        if (oValidObject.isValidObject)
        {
            if (oReadListParam.parameters.length > 0)
            {
                if (oReadListParam.parameters.length > 1)
                {
                    bError = true;
                    sErrorText = "error: Only one parameter can be read";
                }
                else
                {
                    var oValidParams = fnValidateParameters(oReadListParam);

                    if (!oValidParams.areValidParameters)
                    {
                        bError = true;
                        sErrorText = oValidParams.errorText;
                    }
                }
            }
            else
            {
                // kein Parameter angegeben
                bError = true;
                sErrorText = "error: No parameters specified";
            }
        }
        else
        {
            bError = true;
            sErrorText = oValidObject.errorText;
        }

        if (bError)
        {
            // Fehlerrueckgabe
            fnCallBackInErrorCase(oReadListParam, sErrorText);
            return sRc;
        }
        else
        {
            // kein Fehler -> Listenparameter lesen
            oCGI = new COM_GetLst(oReadListParam);
            sRc = this.oHttp.fnRead(oCGI);
        }
    }
    else
    {
        fnCallBackInErrorCase(oReadListParam, "Not logged on server!");
    }

    return sRc;
};

/********************************************************************************************
 * FUNCTION: fnReadMldListVar
 * COMMENT : Liest eindimensionale MLD-Arrays aus
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 **********************************************************************************************/
WebServerInterface.prototype.fnReadMldListVar = function (oReadMldListVar)
{
    var oCGI, sRc = "";

    if (this._bLoggedIn)
    {
        var oError = fnCheckOneParMldVarObject(oReadMldListVar);

        if (oError.bError)
        {
            // Fehlerrueckgabe
            fnCallBackInErrorCase(oReadMldListVar, oError.sErrorText);
            return sRc;
        }
        else
        {
            // kein Fehler -> Listenparameter lesen
            oCGI = new COM_GetLst(oReadMldListVar);
            sRc = this.oHttp.fnRead(oCGI);
        }
    }
    else
    {
        fnCallBackInErrorCase(oReadMldListVar, "Not logged on server!");
    }

    return sRc;
};

/********************************************************************************************
 * FUNCTION: fnWriteParam
 * COMMENT : Beschreibt Standard S- und P-Parameter
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 **********************************************************************************************/
WebServerInterface.prototype.fnWriteParam = function (oWriteParam)
{
    var oCGI, sRc = "", oCheckForErrors = new Object();

    if (this._bLoggedIn)
    {
        oCheckForErrors = fnCheckWriteService(oWriteParam);

        if (oCheckForErrors.bError)
        {
            // Fehlerrueckgabe
            fnCallBackInErrorCase(oWriteParam, oCheckForErrors.sErrorText);
            return sRc;
        }
        else
        {
            oCGI = new COM_SetVar(oWriteParam);
            sRc = this.oHttp.fnWrite(oCGI);
        }
    }
    else
    {
        fnCallBackInErrorCase(oWriteParam, "Not logged on server!");
    }

    return sRc;
};

/********************************************************************************************
 * FUNCTION: fnWriteMldVar
 * COMMENT : Beschreibt MLD-Variablen bzw. mehrdimensionale MLD-Arrays
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 **********************************************************************************************/
WebServerInterface.prototype.fnWriteMldVar = function (oWriteMldVar)
{
    var oCGI, sRc = "", bError = false, sErrorText = "";

    if (this._bLoggedIn)
    {
        var oCheckForErrors = fnCheckMldVarWriteService(oWriteMldVar);

        if (oCheckForErrors.bError)
        {
            bError = true;
            sErrorText = oCheckForErrors.sErrorText;
        }

        if (bError)
        {
            fnCallBackInErrorCase(oWriteMldVar, sErrorText);
            return sRc;
        }
        else
        {
            // Anfrage wird gesendet
            oCGI = new COM_SetMldVar(oWriteMldVar);
            sRc = this.oHttp.fnWrite(oCGI);
        }
    }
    else
    {
        fnCallBackInErrorCase(oWriteMldVar, "Not logged on server!");
    }

    return sRc;
};


/********************************************************************************************
 * FUNCTION: fnWriteListParam
 * COMMENT : Beschreibt S- und P-Listenparameter
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 **********************************************************************************************/
WebServerInterface.prototype.fnWriteListParam = function (oWriteListParam)
{
    var oCGI, sRc = "", oCheckForErrors = new Object();

    if (this._bLoggedIn)
    {
        oCheckForErrors = fnCheckWriteService(oWriteListParam);

        if (oCheckForErrors.bError)
        {
            // Fehlerrueckgabe
            fnCallBackInErrorCase(oWriteListParam, oCheckForErrors.sErrorText);
            return sRc;
        }
        else
        {
            oCGI = new COM_SetLst(oWriteListParam);
            this.oHttp.fnWrite(oCGI);
        }
    }
    else
    {
        fnCallBackInErrorCase(oWriteListParam, "Not logged on server!");
    }

    return sRc;
};

/********************************************************************************************
 * FUNCTION: fnWriteMldListVar
 * COMMENT : Beschreibt eindimensionale MLD-Arrays
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 **********************************************************************************************/
WebServerInterface.prototype.fnWriteMldListVar = function (oWriteMldListVar)
{
    var oCGI, sRc = "", oCheckForErrors = new Object(), bError = false, sErrorText = "";

    if (this._bLoggedIn)
    {
        oCheckForErrors = fnCheckMldVarWriteService(oWriteMldListVar);

        if (oCheckForErrors.bError)
        {
            bError = true;
            sErrorText = oCheckForErrors.sErrorText;
        }

        if (bError)
        {
            fnCallBackInErrorCase(oWriteMldListVar, sErrorText);
            return sRc;
        }
        else
        {
            // kein Fehler
            oCGI = new COM_SetLst(oWriteMldListVar);
            this.oHttp.fnWrite(oCGI);
        }
    }
    else
    {
        fnCallBackInErrorCase(oWriteMldListVar, "Not logged on server!");
    }

    return sRc;
};

/*****************************************************************************
 * FUNCTION: fnGetParameterInformation
 * COMMENT : Liest S- und P-Parameterinformationen (Datentyp, Elementlaenge, aktuelle und maximale Laenge) aus
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 *****************************************************************************/
WebServerInterface.prototype.fnGetParameterInformation = function (oGetParameterInformation)
{
    var oCgi, sRc = "", oValidObject = fnValidServiceObject(oGetParameterInformation), bError = false, sErrorText = "";

    if (this._bLoggedIn)
    {
        if (oValidObject.isValidObject)
        {
            if (oGetParameterInformation.parameters.length > 0)
            {
                if (oGetParameterInformation.parameters.length > 1)
                {
                    bError = true;
                    sErrorText = "error: Only one parameter can be read";
                }
                else
                {
                    var oValidParams = fnValidateParameters(oGetParameterInformation);

                    if (!oValidParams.areValidParameters)
                    {
                        bError = true;
                        sErrorText = oValidParams.errorText;
                    }
                }
            }
            else
            {
                bError = true;
                sErrorText = "error: No parameters specified";
            }
        }
        else
        {
            bError = true;
            sErrorText = oValidObject.errorText;
        }

        if (bError)
        {
            // Fehlerrueckgabe
            fnCallBackInErrorCase(oGetParameterInformation, sErrorText);
            return sRc;
        }
        else
        {
            oCgi = new COM_ReadVarType(oGetParameterInformation);
            sRc = this.oHttp.fnRead(oCgi);
        }
    }
    else
    {
        fnCallBackInErrorCase(oGetParameterInformation, "Not logged on server!");
    }

    return sRc;
};

/*****************************************************************************
 * FUNCTION: fnGetMldVarInformation
 * COMMENT : Liest MLD-Variableninformationen (Datentyp, Elementlaenge, aktuelle und maximale Laenge) aus
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 *****************************************************************************/
WebServerInterface.prototype.fnGetMldVarInformation = function (oGetMldVarInformation)
{
    var oCgi, sRc = "";

    if (this._bLoggedIn)
    {
        var oError = fnCheckOneParMldVarObject(oGetMldVarInformation);

        if (oError.bError)
        {
            // Fehlerrueckgabe
            fnCallBackInErrorCase(oGetMldVarInformation, oError.sErrorText);
            return sRc;
        }
        else
        {
            oCgi = new COM_ReadVarType(oGetMldVarInformation);
            sRc = this.oHttp.fnRead(oCgi);
        }
    }
    else
    {
        fnCallBackInErrorCase(oGetMldVarInformation, "Not logged on server!");
    }

    return sRc;
};

/*****************************************************************************
 * FUNCTION: fnValidateParameters
 * COMMENT : Hilfsfunktion, validiert die Parameter des ComLib-Objekts
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 *****************************************************************************/
function fnValidateParameters(oObject)
{
    var regExpParam = new RegExp("^[SPsp]{1}-\\d{1}-\\d{1,4}(\\.\\d{1,3}){0,2}$"), oValidation = new Object();

    for (var i = 0; i < oObject.parameters.length; i++)
    {
        if (typeof oObject.parameters[i].parameterId == "undefined")
        {
            oValidation.areValidParameters = false;
            oValidation.errorText = "error: Parameter IDN required";
            return oValidation;
        }

        if (!regExpParam.test(oObject.parameters[i].parameterId))
        {
            oValidation.areValidParameters = false;
            oValidation.errorText = "error: Invalid parameter IDN";
            return oValidation;
        }
    }

    oValidation.areValidParameters = true;

    return oValidation;
}

/*****************************************************************************
 * FUNCTION: fnValidServiceObject
 * COMMENT : Hilfsfunktion, validiert das ComLib-Objekts
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 *****************************************************************************/
function fnValidServiceObject(oObject)
{
    var bParametersAvailable = true, bCallbackFunctionAvailable = true;

    // parameters definiert?
    if (typeof oObject.parameters == "undefined")
    {
        bParametersAvailable = false;
    }
    else
    {
        bParametersAvailable = true;
    }

    // callbackFunction angegeben?
    if (typeof oObject.callbackFunction != "function")
    {
        bCallbackFunctionAvailable = false;
    }
    else
    {
        bCallbackFunctionAvailable = true;
    }

    if (bCallbackFunctionAvailable && bParametersAvailable)
    {
        oObject.isValidObject = true;
    }
    else
    {
        oObject.isValidObject = false;

        if (!bCallbackFunctionAvailable)
        {
            oObject.errorText = "error: No callback function";
        }

        if (!bParametersAvailable)
        {
            oObject.errorText = "error: No parameters specified";
        }
    }

    return oObject;
}

/*****************************************************************************
 * FUNCTION: fnCallBackInErrorCase
 * COMMENT : Hilfsfunktion, ruft im Fehlerfall die Callback-Funktion auf
 * INPUT   : ComLib-Objekt, Fehlertext
 * OUTPUT  : 
 *****************************************************************************/
function fnCallBackInErrorCase(oObject, sErrorText)
{
    var oRespone = new Object();

    oRespone = oObject;
    oRespone.onError = sErrorText;
    if (typeof oObject.callbackFunction != "undefined")
    {
        oObject.callbackFunction(oRespone);
    }
}

/*****************************************************************************
 * FUNCTION: fnCheckWriteService
 * COMMENT : Hilfsfunktion, prueft das Objekt zum Schreiben
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 *****************************************************************************/
function fnCheckWriteService(oObject)
{
    var oValidObject = fnValidServiceObject(oObject), oCheck = new Object();

    oCheck.bError = false;
    oCheck.sErrorText = "";

    if (oValidObject.isValidObject)
    {
        if (oObject.parameters.length > 0)
        {
            if (oObject.parameters.length > 1)
            {
                oCheck.bError = true;
                oCheck.sErrorText = "error: Only one parameter can be written";
            }
            else
            {
                if (typeof oObject.parameters[0].data != "undefined")
                {
                    var oValidParams = fnValidateParameters(oObject);

                    if (!oValidParams.areValidParameters)
                    {
                        oCheck.bError = true;
                        oCheck.sErrorText = oValidParams.errorText;
                    }
                }
                else
                {
                    oCheck.bError = true;
                    oCheck.sErrorText = "error: No data submitted";
                }
            }
        }
        else
        {
            oCheck.bError = true;
            oCheck.sErrorText = "error: No parameters specified";
        }
    }
    else
    {
        oCheck.bError = true;
        oCheck.sErrorText = oValidObject.errorText;
    }

    return oCheck;
}

/*****************************************************************************
 * FUNCTION: fnCheckMldVarWriteService
 * COMMENT : Hilfsfunktion, prueft das Objekt zum Schreiben von MLD-Werten
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 *****************************************************************************/
function fnCheckMldVarWriteService(oObject)
{
    var oValidObject = fnValidServiceObject(oObject), oCheck = new Object();

    oCheck.bError = false;
    oCheck.sErrorText = "";

    if (oValidObject.isValidObject)
    {
        if (oObject.parameters.length > 0)
        {
            if (oObject.parameters.length > 1)
            {
                oCheck.bError = true;
                oCheck.sErrorText = "error: Only one variable can be written";
            }
            else
            {

                var oError = fnCheckMldVarIds(oObject);

                if (typeof oObject.parameters[0].data == "undefined")
                {
                    oCheck.bError = true;
                    oCheck.sErrorText = "error: No data submitted";
                }

                if (!oError.bMldVarIdsSpecified)
                {
                    // Keine MLD-Variable angegeben
                    oCheck.bError = true;
                    oCheck.sErrorText = oError.sErrorText;
                }
            }
        }
        else
        {
            oCheck.bError = true;
            oCheck.sErrorText = "error: No variables specified";
        }
    }
    else
    {
        oCheck.bError = true;
        oCheck.sErrorText = oValidObject.errorText;
    }

    return oCheck;
}

/*****************************************************************************
 * FUNCTION: fnCheckOneParMldVarObject
 * COMMENT : Hilfsfunktion, prueft das nur eine MLD-Variable angegeben wurde
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 *****************************************************************************/
function fnCheckOneParMldVarObject(oObject)
{
    var oErrorObject = new Object();

    oErrorObject.bError = false;
    oErrorObject.sErrorText = "";

    var oValidObject = fnValidServiceObject(oObject);

    if (oValidObject.isValidObject)
    {
        if (oObject.parameters.length > 0)
        {
            if (oObject.parameters.length > 1)
            {
                oErrorObject.bError = true;
                oErrorObject.sErrorText = "error: Only one parameter can be read";
            }
            else
            {
                if (typeof oObject.parameters[0].parameterId == "undefined")
                {
                    oErrorObject.bError = true;
                    oErrorObject.sErrorText = "error: parameterId required";
                }
            }
        }
        else
        {
            // kein Parameter angegeben
            oErrorObject.bError = true;
            oErrorObject.sErrorText = "error: No parameters specified";
        }
    }
    else
    {
        oErrorObject.bError = true;
        oErrorObject.sErrorText = oValidObject.errorText;
    }

    return oErrorObject;
}

/*****************************************************************************
 * FUNCTION: fnCheckMldVarIds
 * COMMENT : Hilfsfunktion, prueft das eine MLD-Variable angegeben wurde
 * INPUT   : ComLib-Objekt
 * OUTPUT  : 
 *****************************************************************************/
function fnCheckMldVarIds(oObject)
{
    var oError = new Object();

    oError.bMldVarIdsSpecified = true;
    oError.sErrorText = "";

    for (var i = 0; i < oObject.parameters.length; i++)
    {
        if (typeof oObject.parameters[i].parameterId == "undefined")
        {
            oError.bMldVarIdsSpecified = false;
            oError.sErrorText = "error: parameterId required";
            return oError;
        }
    }

    return oError;
}

var MAX_RETRY_sec = 120,                // Maximum request time allowed (in case device is busy)    
    MAX_ITEMS_PER_REQUEST = 5,        // Max items in GetVar request
    MAX_LIST_ITEMS = 100,              // Max list elements to read per request
//Defdb00143532 DaS: increase Timeout from 2500 to 4000ms
    MIN_XACT_ms = 4000;                // minimum response time from WEB server

// WEB server error codes
var ERROR_ASYNC_TIMEOUT = "error:0",    // Asynchronous message timed out
    ERROR_SYNTAX_ERROR = "error:1",     // syntax error in string sent to WS
    ERROR_INVALID_VAR = "error:2",      // the specified variable does not exist
    ERROR_INVALID_HANDLE = "error:3",   // problem with the communication between the WS and EIS
    ERROR_NO_LOGIN = "error:4",         // the user is not logged into the system
    ERROR_WRONG_VALUE = "error:5",      // the written value does not match the definition????
    ERROR_INVALID_AXIS_NUMBER = "error:6",    // ungueltige Achsnummer
    ERROR_OUT_OF_MEMORY = "error:7",    // the request/response exceeds the maximum length
    ERROR_PERMISION_DENIED = "error:8", // the user is not logged in yet
    ERROR_INVALID_DATA_CONVERT = "error:9", // error converting the data
    ERROR_EMPTY_LIST = "error:10";          // Fehlermeldung des Datenserver beim Lesen einer Liste
ERROR_EIS_RET_FAIL_REQUEST = "error:12", // EIS server returned an unspecified error
ERROR_REG_VAR = "error:13";         // Ungueltiges Handle vom Datenserver, oft: Parameter nicht vorhanden
ERROR_UNREG_VAR1 = "error:14";       // Fehler beim Abmelden einer Variablen
ERROR_UNREG_VAR = "error:20", // could not register handle for variable???
ERROR_NO_SYMBOL_FILE = "error:21", // no items in symbol table
ERROR_UPLOAD_FAILED = "error:22", // error uploading file
ERROR_INVALID_PATH = "error:28", // error uploading file - directory is invalid
ERROR_INVALID_DIR = "error:34", //The specified directory does not exist
ERROR_WRITE_FAILED = "error:518", // error writing data
STATE_WARNING_BUSY = "error:33293", // EIS server is busy processing another request
ERROR_BUSY_TIMEOUT = "error:33293 > Asynchronous Timeout", // EIS server returned busy until request timed out
ERROR_DIR_EMPTY = "empty", //The specified directory is empty - no files found
STATE_WARNING_EMPTY = "error:33294", // No data 
STATE_WARNING_EMPTY_LIST = "error:33296", // No data elements in list
SERVICE_UNKNOWN = "Service unknown!", // WEB server service is not supported
ERROR_NOT_WRITEABLE = "error:40", //Folder doesn't exist or not writable
ERROR_INVALID_ARG = "error:39", //Web server invalid argument
ERROR_INVALID_FILENAME = "error:27", //Web server invalid file name
ERROR_ID_NOT_THERE = "error:4097",
ERROR_NO_NAME = "error:8193",
ERROR_NAME_TOO_SHORT = "error:8194",
ERROR_NAME_TOO_LONG = "error:8195",
ERROR_WRITE_NAME = "error:8196",
ERROR_JUST_NO_NAME = "error:8197",
ERROR_ATTR_TOO_SHORT = "error:12290",
ERROR_ATTR_TOO_LONG = "error:12291",
ERROR_WRITE_ATTR = "error:12292",
ERROR_JUST_NO_ATTR = "error:12293",
ERROR_NO_UNIT = "error:16385",
ERROR_UNIT_TOO_SHORT = "error:16386",
ERROR_UNIT_TOO_LONG = "error:16387",
ERROR_WRITE_UNIT = "error:16388",
ERROR_JUST_NO_UNIT = "error:16389",
ERROR_NO_MIN = "error:20481",
ERROR_MIN_TOO_SHORT = "error:20482",
ERROR_MIN_TOO_LONG = "error:20483",
ERROR_WRITE_MIN = "error:20484",
ERROR_JUST_NO_MIN = "error:20485",
ERROR_NO_MAX = "error:24577",
ERROR_MAX_TOO_SHORT = "error:24578",
ERROR_MAX_TOO_LONG = "error:24579",
ERROR_WRITE_MAX = "error:24580",
ERROR_JUST_NO_MAX = "error:24581",
ERROR_DATA_TOO_SHORT = "error:28674",
ERROR_DATA_TOO_LONG = "error:28675",
ERROR_WRITE_DATA = "error:28676",
ERROR_JUST_NO_DATA = "error:28677",
ERROR_DATA_TOO_SMALL = "error:28678",
ERROR_DATA_TOO_LARGE = "error:28679",
ERROR_DATA_NOT_CORRECT = "error:28680",
ERROR_WRITE_DATA_PASS = "error:28681",
ERROR_NO_WRITE_DATA_NOW = "error:28682",
ERROR_ADR_NOT_KORREKT = "error:28683",
ERROR_PROTECTED_BY_OTHERS = "error:28684";

var g_sHost = ["http://", window.top.document.location.host].join(""); // http://x.x.x.x/
// The WEB server for the MLD embeds extended ASCII characters in the messages using it's own unique format!
var g_aCharacterConversion = [["\xC4", new RegExp("&#196;", "g")], //"Ä"
                               ["\xE4", new RegExp("&#228;", "g")], //"ä"
                               ["\xDF", new RegExp("&#223;", "g")], //"ß"
                               ["\xD6", new RegExp("&#214;", "g")], //"Ö"
                               ["\xF6", new RegExp("&#246;", "g")], //"ö"
                               ["\xDC", new RegExp("&#220;", "g")], //"Ü"
                               ["\xFC", new RegExp("&#252;", "g")], //"ü"
                               ["\xB0", new RegExp("&#164;", "g")]]; //"°"

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : Object which can be passed into the validation function and modified.
* INPUT   : string to initialize object (optional)
* OUTPUT  : none
**************************************************************************************************/
function StringRef(sValue)
{
    this.sTypeOf = 'StringRef';
    // class properties
    this.value = ""; // storage for string data
    if (arguments.length == 1) { this.value = sValue; } // optional initializer
    // class methods
    this.setValue = function (sNewValue) { this.value = sNewValue; }; // use instead of assignment operator
    // string method overrides
    this.valueOf = this.toSource = this.toString = function () { return this.value; };
    this.indexOf = function (sSearch) { return this.value.indexOf(sSearch); };
    this.toLowerCase = function () { return this.value.toLowerCase(); };
    this.toUpperCase = function () { return this.value.toUpperCase(); };
    this.split = function (sStr) { return this.value.split(sStr); };
    this.search = function (sStr) { return this.value.search(sStr); };
    this.substr = function (nStart, nEnd) { return this.value.substr(nStart, nEnd); };
}

/*************************************************************************************************
* ComLibObject
* COMMENT : Objekt zur ComLib.
* INPUT   : - 
* OUTPUT  : -
**************************************************************************************************/
function ComLibObject()
{
    this.callbackFunction = null;
    this.parameters = [];
    this.callbackData = null;
}

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : Basisobjekt der Kommunikation.
* INPUT   : -
* OUTPUT  : -
**************************************************************************************************/
function COM_Obj()
{
    this.sTypeOf = 'COM_Obj';
    this.HTTP_Type = "GET";
    this.sRequest = "";      // request string
    this.sResponse = "";     // parsed response from server
    this.fnCallback = null;  // asynch callback function
    this.oCbData = null;     // data to pass to async callback
    this.nAsyncTimeout_ms = MIN_XACT_ms; // timeout for asynchronous timer
    this.nAsyncRetry = 2;    // # of times to retry message after timeout
    this.fnOnAsyncTimeout = this._fnOnAsyncTimeout;
    this.oDate = new Date(); // maximum retry timer (in case control is busy)
    this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
    this.bIsRetryWithNewRequest = false;  //Defdb00143532  === true In case of readVarInfo followed by GetVar or GetLst --> dp Retry without SetTimeOut 

    /*************************************************************************************************
    * FUNCTION: fnIsValidParameterFormat
    * COMMENT : Prueft die Parameter-Id auf Gueltigkeit
    * INPUT   : sId
    * OUTPUT  : true/false
    **************************************************************************************************/
    this.fnIsValidParameterFormat = function (sId)
    {
        var regExpParam = new RegExp("^(\\d{1,3},\\d{1,3},)?[SPsp]{1}-\\d{1}-\\d{1,4}(\\.\\d{1,3}){0,3}$");

        return regExpParam.test(sId);
    };

    /*************************************************************************************************
    * FUNCTION: fnAddValuesToObject
    * COMMENT : Fuegt die gelesenen Werte zum Objekt hinzu
    * INPUT   : ComLib-Objekt, ausgelesene Werte
    * OUTPUT  : Ergaenztes Objekt
    **************************************************************************************************/
    this.fnAddValuesToObject = function (oObject, sValues)
    {
        var aValues = sValues.split("|");

        for (var i = 0; i < oObject.parameters.length; i++)
        {
            oObject.parameters[i].value = aValues[i];
        }

        return oObject;
    };

    /*************************************************************************************************
    * FUNCTION: fnConvertToS3
    * COMMENT : Formatiert die Ids
    * INPUT   : sId
    * OUTPUT  : sId formatiert
    **************************************************************************************************/
    this.fnConvertToS3 = function (sId)
    {
        var aSplit = [];

        if (this.fnIsValidParameterFormat(sId))
        {
            aSplit = sId.split(".");
            switch (aSplit.length)
            {
                case 1:
                    sId += ".0.0";
                    break;
                case 2:
                    sId = aSplit.join(".0");
                    break;
                default:
                    break;
            }
        }
        return sId;
    }

    /*************************************************************************************************
    * FUNCTION: fnGetIntFromString
    * COMMENT : Wandelt einen String nach Int
    * INPUT   : String
    * OUTPUT  : Int
    **************************************************************************************************/
    this.fnGetIntFromString = function (sValue)
    {
        var nValue = 0;

        if (sValue.substring(0, 2) == "0b")
        {
            nValue = parseInt(sValue.substring(2), 2);
        }
        else
        {
            // Hex mit Praefix "0x" wird automatisch erkannt 
            nValue = parseInt(sValue);
        }

        return nValue;
    };

    /*************************************************************************************************
    * FUNCTION: fnAddValuesToListObject
    * COMMENT : Fuegt die gelesenen Werte zum Listenobjekt hinzu
    * INPUT   : ComLib-Objekt, ausgelesene Werte
    * OUTPUT  : Ergaenztes Objekt
    **************************************************************************************************/
    this.fnAddValuesToListObject = function (oObject, aValues, nOffset, nCount)
    {
        oObject.parameters[0].value = undefined;
        oObject.parameters[0].value = [];

        if (this._fnIsError(aValues.toString()))
        {
            oObject.parameters[0].value = aValues;
        }
        else
        {
            if ((aValues != null) && (aValues.length > 0))
            {
                // aktuell wird immer ein Array beginnend bei 0 erstellt, evtl. koennte man wieder erst beim Offsetindex beginnen
                //if (typeof nOffset != "undefined")
                //{
                //    for (var nOffsetIndex = nOffset, nValuesIndex = 0; nValuesIndex < aValues.length; nOffsetIndex++, nValuesIndex++)
                //    {
                //        oObject.parameters[0].value[nOffsetIndex] = aValues[nValuesIndex];
                //    }
                //}
                //else
                //{
                //    oObject.parameters[0].value = aValues;
                //}
                oObject.parameters[0].value = aValues;
            }
            else
            {
                oObject.parameters[0].value = [];
            }
        }

        return oObject;
    };

    /*************************************************************************************************
* FUNCTION: fnGetParamsWithAxisNrAndElemNr
* COMMENT : Ergaenzt bei Parameter-Ids die Achsnummer und Elementnummer
* INPUT   : ComLib-Objekt
* OUTPUT  : Bearbeitete Ids als Array
**************************************************************************************************/
    this.fnGetParamsWithAxisNrAndElemNr = function (oObj)
    {
        var aId = [], nAxisNr = 1, nElemNr = 7;

        for (var i = 0; i < oObj.parameters.length; i++)
        {
            if (typeof oObj.parameters[i].axisNumber == "undefined")
            {
                // Keine Achsnummer angegeben --> Default: Achse 1
                nAxisNr = 1;
            }
            else
            {
                nAxisNr = oObj.parameters[i].axisNumber;
            }

            if (typeof oObj.parameters[i].parameterElement == "undefined")
            {
                // Kein Sercoselement angegeben --> Default: Betriebsdatum 7
                nElemNr = 7;
            }
            else
            {
                switch (oObj.parameters[i].parameterElement.toLowerCase())
                {
                    case "name":
                        nElemNr = 2;
                        break;
                    case "attribute":
                        nElemNr = 3;
                        break;
                    case "unit":
                        nElemNr = 4;
                        break;
                    case "min":
                        nElemNr = 5;
                        break;
                    case "max":
                        nElemNr = 6;
                        break;
                    case "value":
                        nElemNr = 7;
                        break;
                    case "status":
                        nElemNr = 8;
                        break;
                    default:
                        nElemNr = 7;
                        break;
                }
            }

            aId.push("0," + nAxisNr + "," + this.fnConvertToS3(oObj.parameters[i].parameterId) + "." + nElemNr);
        }

        return aId;
    };

    /*************************************************************************************************
    * FUNCTION: fnGetParamWithAxisNr
    * COMMENT : Ergaenzt bei einer Parameter-Id die Achsnummer
    * INPUT   : ComLib-Objekt
    * OUTPUT  : Bearbeitete Id
    **************************************************************************************************/
    this.fnGetParamWithAxisNr = function (oObj)
    {
        var nAxisNr = 1;

        if (this.fnIsValidParameterFormat(oObj.parameters[0].parameterId))
        {
            if (typeof oObj.parameters[0].axisNumber == "undefined")
            {
                // Keine Achsnummer angegeben --> Default: Achse 1
                nAxisNr = 1;
            }
            else
            {
                nAxisNr = oObj.parameters[0].axisNumber;
            }

            return "0," + nAxisNr + "," + this.fnConvertToS3(oObj.parameters[0].parameterId);
        }
        else
        {
            return oObj.parameters[0].parameterId;
        }
    };

    /*************************************************************************************************
    * FUNCTION: _fnGetErrorMessage
    * COMMENT : Interpretiert die Fehlercodes
    * INPUT   : Fehlercode
    * OUTPUT  : Fehlertext
    **************************************************************************************************/
    this._fnGetErrorMessage = function (sErrorCode)
    {
        var sMsg = "";
        switch (sErrorCode)
        {
            case ERROR_SYNTAX_ERROR:
                // syntax error in string sent to WS
                sMsg = "Communication Syntax Error!";
                break;
            case ERROR_INVALID_VAR:
                sMsg = "Variable/parameter does not exist!";
                break;
            case ERROR_INVALID_AXIS_NUMBER:
                sMsg = "Axis number does not exist!";
                break;
            case ERROR_INVALID_DATA_CONVERT:
                sMsg = "Internal error converting data format!";
                break;
            case ERROR_EMPTY_LIST:
                sMsg = "List is empty!";
                break;
            case ERROR_REG_VAR:
                sMsg = "Invalid handle from the data server";
                break;
            case ERROR_UNREG_VAR1:
                sMsg = "Error when logging off a variable";
                break;
            case ERROR_UNREG_VAR:
                sMsg = "Could not register handle for variable";
                break;
            case ERROR_NO_SYMBOL_FILE:
                sMsg = "No items in symbol table";
                break;
            case ERROR_UPLOAD_FAILED:
                sMsg = "Error when uploading file";
                break;
            case ERROR_INVALID_PATH:
                sMsg = "Error when uploading file, directory is invalid";
                break;
            case ERROR_INVALID_DIR:
                sMsg = "The specified directory does not exist";
                break;
            case ERROR_DIR_EMPTY:
                sMsg = "The specified directory is empty - no files found";
                break;
            case STATE_WARNING_BUSY:
                sMsg = "EIS server is busy processing another request";
                break;
            case STATE_WARNING_EMPTY:
                sMsg = "No data";
                break;
            case STATE_WARNING_EMPTY_LIST:
                sMsg = "No data elements in list";
                break;
            case SERVICE_UNKNOWN:
                sMsg = "Service unknown!";
                break;
            case ERROR_NOT_WRITEABLE:
                sMsg = "Folder doesn't exist or not writable";
                break;
            case ERROR_INVALID_ARG:
                sMsg = "Web server invalid argument";
                break;
            case ERROR_INVALID_FILENAME:
                sMsg = "Web server invalid file name";
                break;
            case ERROR_INVALID_HANDLE:
                // problem with the communication between the WS and EIS
                sMsg = "Internal error in the web server!";
                break;
            case ERROR_PERMISION_DENIED:
                // the user is not logged in yet
            case ERROR_NO_LOGIN:
                // the user is not logged into the system
                sMsg = "Your login to the WEB server has expired!";
                break;
            case ERROR_WRONG_VALUE:
                // the written value does not match the definition????
                sMsg = "The data written is in the wrong format!";
                break;
            case ERROR_OUT_OF_MEMORY:
                // the request/response exceeds the maximum length
                sMsg = "Communication telegram exceeds maximum length!";
                break;
            case ERROR_EIS_RET_FAIL_REQUEST:
                // EIS server returned an unspecified error
                sMsg = "The EIS server returned an unspecified error!";
                break;
            case ERROR_WRITE_FAILED:
                // error writing data
                sMsg = "Error writing data!";
                break;
            case ERROR_ASYNC_TIMEOUT:
                sMsg = "The WEB server is not responding!";
                break;
            case ERROR_BUSY_TIMEOUT:
                // internal error used when server was busy too long
                sMsg = "The maximum execution time limit is exceeded!";
                break;
            case ERROR_ID_NOT_THERE:
                sMsg = "Id does not exist!";
                break;
            case ERROR_NO_NAME:
                sMsg = "Name does not exist!";
                break;
            case ERROR_NAME_TOO_SHORT:
                sMsg = "Name transferred to short!";
                break;
            case ERROR_NAME_TOO_LONG:
                sMsg = "Name transferred to long!";
                break;
            case ERROR_WRITE_NAME:
                sMsg = "Name not writable!";
                break;
            case ERROR_JUST_NO_NAME:
                sMsg = "Name for now not writable!";
                break;
            case ERROR_ATTR_TOO_SHORT:
                sMsg = "Attribute transferred to short!";
                break;
            case ERROR_ATTR_TOO_LONG:
                sMsg = "Attribute transferred to long!";
                break;
            case ERROR_WRITE_ATTR:
                sMsg = "Attribute not writable!";
                break;
            case ERROR_JUST_NO_ATTR:
                sMsg = "Attribute for now not writable!";
                break;
            case ERROR_NO_UNIT:
                sMsg = "Unit does not exist!";
                break;
            case ERROR_UNIT_TOO_SHORT:
                sMsg = "Unit transferred to short!";
                break;
            case ERROR_UNIT_TOO_LONG:
                sMsg = "Unit transferred to long!";
                break;
            case ERROR_WRITE_UNIT:
                sMsg = "Unit not writable!";
                break;
            case ERROR_JUST_NO_UNIT:
                sMsg = "Unit for now not writable!";
            case ERROR_NO_MIN:
                sMsg = "Minimum does not exist!";
                break;
            case ERROR_MIN_TOO_SHORT:
                sMsg = "Minimum transferred to short!";
                break;
            case ERROR_MIN_TOO_LONG:
                sMsg = "Minimum transferred to long!";
                break;
            case ERROR_WRITE_MIN:
                sMsg = "Minimum not writable!";
                break;
            case ERROR_JUST_NO_MIN:
                sMsg = "Minimum for now not writable!";
                break;
            case ERROR_NO_MAX:
                sMsg = "Maximum does not exist!";
                break;
            case ERROR_MAX_TOO_SHORT:
                sMsg = "Maximum transferred to short!";
                break;
            case ERROR_MAX_TOO_LONG:
                sMsg = "Maximum transferred to long!";
                break;
            case ERROR_WRITE_MAX:
                sMsg = "Maximum not writable!";
                break;
            case ERROR_JUST_NO_MAX:
                sMsg = "Maximum for now not writable!";
                break;
            case ERROR_DATA_TOO_SHORT:
                sMsg = "Data transferred to short!";
                break;
            case ERROR_DATA_TOO_LONG:
                sMsg = "Data transferred to long!";
                break;
            case ERROR_WRITE_DATA:
                sMsg = "Data not writable!";
                break;
            case ERROR_JUST_NO_DATA:
                sMsg = "Date for now not writable!";
                break;
            case ERROR_DATA_TOO_SMALL:
                sMsg = "Data to small!";
                break;
            case ERROR_DATA_TOO_LARGE:
                sMsg = "Data to large!";
                break;
            case ERROR_DATA_NOT_CORRECT:
                sMsg = "Id is not supported, invalid bit number oder bit combination!";
                break;
            case ERROR_WRITE_DATA_PASS:
                sMsg = "Data read-only by client password!";
                break;
            case ERROR_NO_WRITE_DATA_NOW:
                sMsg = "Data currently read-only because it is cyclically configured!";
                break;
            case ERROR_ADR_NOT_KORREKT:
                sMsg = "Invalid indirect addressing!";
                break;
            case ERROR_PROTECTED_BY_OTHERS:
                sMsg = "Data currently write protected due to other settings!";
                break;
            default:
                sMsg = sErrorCode;
                break;
        }
        return sMsg;
    };

    /*************************************************************************************************
* FUNCTION: _fnIsError
* COMMENT : Liefert true, falls der Response-String ein Fehler ist
* INPUT   : Response vom Webserver
* OUTPUT  : true/false
**************************************************************************************************/
    this._fnIsError = function (sResponse)
    {
        var bRc = true;

        switch (sResponse.toString())
        {
            case ERROR_ASYNC_TIMEOUT:
            case ERROR_INVALID_VAR:   // variable/parameter does not exist
            case ERROR_SYNTAX_ERROR:     // syntax error in string sent to WS
            case ERROR_INVALID_HANDLE:   // problem with the communication between the WS and EIS
            case ERROR_NO_LOGIN:         // the user is not logged into the system
            case ERROR_WRONG_VALUE:      // the written value does not match the definition????
            case ERROR_INVALID_AXIS_NUMBER:    // the specified parameter does not exist
            case ERROR_OUT_OF_MEMORY:    // the request/response exceeds the maximum length
            case ERROR_PERMISION_DENIED: // the user is not logged in yet
            case ERROR_INVALID_DATA_CONVERT: // error converting the data
            case ERROR_EIS_RET_FAIL_REQUEST: // EIS server returned an unspecified error
            case ERROR_UNREG_VAR:       // could not register handle for variable???
            case ERROR_NO_SYMBOL_FILE:  // no items in symbol table
            case ERROR_UPLOAD_FAILED:   // error uploading file
            case ERROR_WRITE_FAILED:   // error writing data
            case ERROR_BUSY_TIMEOUT: // internal error used when server was busy too long
            case ERROR_DIR_EMPTY: // The specified directory is empty
            case SERVICE_UNKNOWN:   // WEB server service is not supported
            case ERROR_NOT_WRITEABLE: //Folder doesn't exist or is not writable
            case ERROR_INVALID_ARG: //Web server invalid argument
            case ERROR_INVALID_FILENAME: //Web server invalid file name
            case ERROR_REG_VAR:
            case ERROR_UNREG_VAR1:
            case ERROR_INVALID_DIR:
            case ERROR_INVALID_PATH:
            case STATE_WARNING_BUSY:
            case STATE_WARNING_EMPTY:
            case STATE_WARNING_EMPTY_LIST:
            case ERROR_ID_NOT_THERE:
            case ERROR_NO_NAME:
            case ERROR_NAME_TOO_SHORT:
            case ERROR_NAME_TOO_LONG:
            case ERROR_WRITE_NAME:
            case ERROR_JUST_NO_NAME:
            case ERROR_ATTR_TOO_SHORT:
            case ERROR_ATTR_TOO_LONG:
            case ERROR_WRITE_ATTR:
            case ERROR_JUST_NO_ATTR:
            case ERROR_NO_UNIT:
            case ERROR_UNIT_TOO_SHORT:
            case ERROR_UNIT_TOO_LONG:
            case ERROR_WRITE_UNIT:
            case ERROR_JUST_NO_UNIT:
            case ERROR_NO_MIN:
            case ERROR_MIN_TOO_SHORT:
            case ERROR_MIN_TOO_LONG:
            case ERROR_WRITE_MIN:
            case ERROR_JUST_NO_MIN:
            case ERROR_NO_MAX:
            case ERROR_MAX_TOO_SHORT:
            case ERROR_MAX_TOO_LONG:
            case ERROR_WRITE_MAX:
            case ERROR_JUST_NO_MAX:
            case ERROR_DATA_TOO_SHORT:
            case ERROR_DATA_TOO_LONG:
            case ERROR_WRITE_DATA:
            case ERROR_JUST_NO_DATA:
            case ERROR_DATA_TOO_SMALL:
            case ERROR_DATA_TOO_LARGE:
            case ERROR_DATA_NOT_CORRECT:
            case ERROR_WRITE_DATA_PASS:
            case ERROR_NO_WRITE_DATA_NOW:
            case ERROR_ADR_NOT_KORREKT:
            case ERROR_PROTECTED_BY_OTHERS:
                bRc = true;
                break;
            default:
                var regExpError = new RegExp("^error:\\d{1,8}");

                if (regExpError.test(sResponse.toString()))
                {
                    bRc = true;
                }
                else
                {
                    bRc = false;
                }
                break;
        }

        return bRc;
    };

    /*************************************************************************************************
* FUNCTION: fnValidateResponse
* COMMENT : Hilfsfunktion, Liefert die Fehlermeldung
* INPUT   : Response und Id
* OUTPUT  : TRUE, falls es wiederholt werden soll
**************************************************************************************************/
    this.fnValidateResponse = function (sResponse, sId)
    {
        var nIndex, sText, bRc = false, bErrorAccepted = true, oObject = new ComLibObject();

        oObject.callbackFunction = this.cbValidateResponse;

        if (sResponse.indexOf("error:") === 0)
        {
            switch (sResponse.toString())
            {
                // Informational errors - no retry 
                case ERROR_INVALID_VAR:     // variable/parameter does not exist
                case ERROR_NO_SYMBOL_FILE:  // no symbol table file on control
                case ERROR_UPLOAD_FAILED:   // error uploading file
                case ERROR_WRITE_FAILED:
                case ERROR_REG_VAR:
                case ERROR_UNREG_VAR1:
                case ERROR_EMPTY_LIST:
                case ERROR_REG_VAR:
                case ERROR_UNREG_VAR1:
                case ERROR_INVALID_DIR:
                case ERROR_INVALID_PATH:
                case STATE_WARNING_BUSY:
                case STATE_WARNING_EMPTY:
                case STATE_WARNING_EMPTY_LIST:
                case ERROR_ID_NOT_THERE:
                case ERROR_NO_NAME:
                case ERROR_NAME_TOO_SHORT:
                case ERROR_NAME_TOO_LONG:
                case ERROR_WRITE_NAME:
                case ERROR_JUST_NO_NAME:
                case ERROR_ATTR_TOO_SHORT:
                case ERROR_ATTR_TOO_LONG:
                case ERROR_WRITE_ATTR:
                case ERROR_JUST_NO_ATTR:
                case ERROR_NO_UNIT:
                case ERROR_UNIT_TOO_SHORT:
                case ERROR_UNIT_TOO_LONG:
                case ERROR_WRITE_UNIT:
                case ERROR_JUST_NO_UNIT:
                case ERROR_NO_MIN:
                case ERROR_MIN_TOO_SHORT:
                case ERROR_MIN_TOO_LONG:
                case ERROR_WRITE_MIN:
                case ERROR_JUST_NO_MIN:
                case ERROR_NO_MAX:
                case ERROR_MAX_TOO_SHORT:
                case ERROR_MAX_TOO_LONG:
                case ERROR_WRITE_MAX:
                case ERROR_JUST_NO_MAX:
                case ERROR_DATA_TOO_SHORT:
                case ERROR_DATA_TOO_LONG:
                case ERROR_WRITE_DATA:
                case ERROR_JUST_NO_DATA:
                case ERROR_DATA_TOO_SMALL:
                case ERROR_DATA_TOO_LARGE:
                case ERROR_DATA_NOT_CORRECT:
                case ERROR_WRITE_DATA_PASS:
                case ERROR_NO_WRITE_DATA_NOW:
                case ERROR_ADR_NOT_KORREKT:
                case ERROR_PROTECTED_BY_OTHERS:
                    break;

                case ERROR_EIS_RET_FAIL_REQUEST:
                    nIndex = sId.lastIndexOf(".4");
                    if (nIndex < 0 || sId.length - nIndex != 2)
                    {
                        break;
                    }
                    sResponse.setValue(""); // reset the data
                    break;

                case ERROR_INVALID_DIR:    //The specified directory does not exist
                    sResponse.setValue(ERROR_DIR_EMPTY); // reset the data
                    break;

                case STATE_WARNING_EMPTY_LIST:
                case STATE_WARNING_EMPTY:
                    sResponse.setValue(""); // reset the data
                    break;

                case ERROR_OUT_OF_MEMORY:
                    sText = "COMMUNICATION ERROR";
                    sText += " (" + sId + ") ";
                    sText += "Communication telegram exceeds maximum length!";
                    alert(sText);
                    break;

                    // Fatal errors in the WS   
                case ERROR_UNREG_VAR:       // could not register handle for variable???
                case ERROR_INVALID_HANDLE:
                case ERROR_INVALID_AXIS_NUMBER:
                    if (typeof window.top.document.oWS.bReLogin != "undefined")
                    {
                        if (window.top.document.oWS.bReLogin)
                        {
                            bErrorAccepted = false;
                        }
                        else
                        {
                            bErrorAccepted = true;
                        }
                    }
                    else
                    {
                        bErrorAccepted = true;
                    }

                    if (bErrorAccepted)
                    {
                        sText = "COMMUNICATION ERROR";
                        sText += " (" + sId + " / " + sResponse.toString() + ") ";
                        sText += "An internal error has occurred in the WEB server.";
                        alert(sText);
                    }

                    break;

                case ERROR_NO_LOGIN:  // the user is not logged in
                    if (window.top.document.oWS.fnIsLoggedIn())
                    {
                        document.oWS.fnLogOut(oObject);
                        sText = this._fnGetErrorMessage(ERROR_NO_LOGIN);
                        alert(sText);
                    }
                    break;
                case ERROR_PERMISION_DENIED: // user not logged in        
                    if (window.top.document.oWS.fnIsLoggedIn())
                    {
                        //Defdb00138434: IMST: Im Firefox läuft der Login ab, auch wenn man damit arbeitet
                        window.top.document.oWS.fnLogin(oObject);
                    }
                    else
                    {
                        sText = this._fnGetErrorMessage(ERROR_NO_LOGIN);
                        alert(sText);
                    }
                    break;

                    // Temporary errors which should be retried         
                case STATE_WARNING_BUSY:
                    bRc = true;
                    break;

                default:
                    break;
            }
        }
        return bRc;
    };

    this.cbValidateResponse = function (oResponse)
    {

    };
}

COM_Obj.prototype.fnCanRetry = function ()
{
    var bRc = false, oDate;
    // only asynchronous transactions can be retried or the stack runs out
    if (this.fnCallback && "function" == typeof this.fnCallback)
    {
        oDate = new Date();
        bRc = (oDate < this.oDate) ? true : false;
        oDate = null;
    }
    return bRc;
};

COM_Obj.prototype.fnResetRetryTimer = function ()
{
    this.nAsyncRetry = 2;
    this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
};

COM_Obj.prototype.fnInvokeCallback = function ()
{
    var bRetry = false;
    try
    {
        if ("function" == typeof this.fnCallback)
        {
            // If the callback function returns true then there was an error and a retry is made
            if (typeof this.oResponse == "undefined")
            {
                if (this.fnCallback(this.sResponse, this.oCbData, this) && this.fnCanRetry())
                {
                    bRetry = true;
                }
            }
            else
            {
                if (this.fnCallback(this.oResponse) && this.fnCanRetry())
                {
                    bRetry = true;
                }
            }
        }
    }
    catch (e)
    {
        if (e.number != -2146823277) // script was unloaded
        {

        }
    }
    return bRetry;
};

COM_Obj.prototype._fnOnAsyncTimeout = function ()
{
    this.sResponse = ERROR_ASYNC_TIMEOUT;
    this.fnInvokeCallback();
};

COM_Obj.prototype.fnConvertSpecialChars = function (sResp)
{
    var i, l;
    for (i = 0, l = g_aCharacterConversion.length; i < l; i++)
    {
        sResp = sResp.replace(g_aCharacterConversion[i][1], g_aCharacterConversion[i][0]);
    }
    return sResp;
};

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : Login-Objekt
* INPUT   : sName, sPass, fnCallback, oCbData, oCbData2
* OUTPUT  : -
**************************************************************************************************/
//function COM_Login(sName, sPass, fnCallback, oCbData, oCbData2)
function COM_Login(oLogin)
{
    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_Login';
    this.fnCallback = oLogin.callbackFunction2; // asynch callback function
    this.oCbData = oLogin.callbackFunction;    // data to pass to async callback
    this.oCbData2 = oLogin.callbackData2;
    // initialize the object specific properties
    this.oRequest = oLogin;
    this.sRequest = [g_sHost, "/login.cgi?name=", oLogin.user, "&passwd=", oLogin.password].join("");
    this.nAsyncTimeout_ms = MIN_XACT_ms;    // timeout for asynchronous timer
}
COM_Login.prototype = new COM_Obj();
COM_Login.prototype.constructor = COM_Login;

COM_Login.prototype.fnParseResponse = function (sResponse)
{
    var sItem = "login=", bRc = true, sRef;

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, "Login");
        this.sResponse = sRef.toString();
    }
    return bRc;
};

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : Logout-Objekt
* INPUT   : fnCallback
* OUTPUT  : -
**************************************************************************************************/
function COM_Logout(oLogout)
{
    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_Logout';
    // initialize the object specific properties
    this.fnCallback = oLogout.callbackFunction; // asynch callback function
    this.oRequest = oLogout;
    this.sRequest = [g_sHost, "/logout.cgi"].join("");
    this.nAsyncTimeout_ms = MIN_XACT_ms;    // timeout for asynchronous timer
}
COM_Logout.prototype = new COM_Obj();
COM_Logout.prototype.constructor = COM_Logout;

COM_Logout.prototype.fnParseResponse = function (sResponse)
{
    var sItem = "logout=", bRc = true, sRef;

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, "logout");
        this.sResponse = sRef.toString();
        this.oResponse = this.oRequest;
        this.oResponse.value = this.sResponse;
    }
    return bRc;
};

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : GetMldVar-Objekt
* INPUT   : ComLib-Objekt
* OUTPUT  : -
**************************************************************************************************/
function COM_GetMldVar(oGetMldVar)
{
    /*************************************************************************************************
    * FUNCTION: fnGetVarsWithAxisNr
    * COMMENT : Ergaenzt bei den Parameter-Ids die Achsnummer
    * INPUT   : ComLib-Objekt
    * OUTPUT  : Bearbeitete Ids als Array
    **************************************************************************************************/
    this.fnGetVarsWithAxisNr = function (oObj)
    {
        var aId = [], nAxisNr = 1;

        for (var i = 0; i < oObj.parameters.length; i++)
        {
            if (typeof oObj.parameters[i].axisNumber == "undefined")
            {
                // Keine Achsnummer angegeben --> Default: Achse 1
                nAxisNr = 1;
            }
            else
            {
                nAxisNr = oObj.parameters[i].axisNumber;
            }

            aId.push("0," + nAxisNr + "," + oObj.parameters[i].parameterId);
        }

        return aId;
    };

    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_GetMldVar';
    this.fnCallback = oGetMldVar.callbackFunction; // asynch callback function
    this.oCbData = oGetMldVar.callbackData;       // data to pass to async callback
    this.aId = this.fnGetVarsWithAxisNr(oGetMldVar);
    this.aCurRequestId = [];
    this.aResponse = [];          // array of responses
    this.oRequest = oGetMldVar;
    this.sRequest = this.fnBuildRequest(this.aId);
}
COM_GetMldVar.prototype = new COM_Obj();
COM_GetMldVar.prototype.constructor = COM_GetMldVar;

COM_GetMldVar.prototype.fnBuildRequest = function (aMldVar)
{
    var nMldVar, nVar, nMldVars, aReq = [];
    nMldVars = aMldVar.length;
    // limit the number of items requested at one time
    if (nMldVars > MAX_ITEMS_PER_REQUEST) { nMldVars = MAX_ITEMS_PER_REQUEST; }
    // build the request string
    aReq[aReq.length] = [g_sHost, "/getvar.cgi?var1=", aMldVar[0]].join("");
    for (nMldVar = 1, nVar = 2; nMldVar < nMldVars; nMldVar++, nVar++)
    {
        aReq[aReq.length] = ["var", nVar, "=", aMldVar[nMldVar]].join("");
    }
    this.nAsyncTimeout_ms = MIN_XACT_ms + (nMldVars * 400);    // timeout for asynchronous timer
    return aReq.join('&');
};

COM_GetMldVar.prototype.fnParseResponse = function (sResponse)
{
    var aRetry = [], sItem, nItem, nStart, nEnd, nItems;

    nItems = this.aId.length;
    for (nEnd = nItem = 0; nItem < nItems; nItem++)
    {
        sItem = this.aId[nItem] + "=";
        nStart = sResponse.indexOf(sItem);
        if (nStart < 0) // item not found
        {
            continue;
        }
        nEnd = sResponse.indexOf('&', nStart);
        if (nEnd < 0)
        {
            this.aResponse[nItem] = new StringRef(sResponse.slice(nStart + sItem.length));
        }
        else
        {
            this.aResponse[nItem] = new StringRef(sResponse.slice(nStart + sItem.length, nEnd));
        }

        // Check for retry errors
        if (this.fnValidateResponse(this.aResponse[nItem], this.aId[nItem]))
        {
            aRetry[aRetry.length] = this.aId[nItem];
        }
    }
    // Build a string of retries
    if (aRetry.length && this.fnCanRetry())
    {
        this.sRequest = this.fnBuildRequest(aRetry);
        return true;
    }
    // larger request blocks are broken into multiple reads
    if (this.aId.length > this.aResponse.length)
    {
        aRetry.length = 0;
        nItems = this.aId.length;
        for (nEnd = 0, nItem = this.aResponse.length; nItem < nItems; nItem++, nEnd++)
        {
            aRetry[nEnd] = this.aId[nItem];
        }
        this.sRequest = this.fnBuildRequest(aRetry);
        this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
        return true;
    }
    // Save the response
    this.sResponse = this.aResponse.join('|');
    this.oResponse = this.fnAddValuesToObject(this.oRequest, this.aResponse.join('|'));

    return false;
};

/*************************************************************************************************
* CONSTRUCTOR 
* COMMENT : COM_GetVar-Objekt
* INPUT   : ComLib-Objekt
* OUTPUT  : -
**************************************************************************************************/
function COM_GetVar(oReadParam)
{
    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_GetVar';
    this.fnCallback = oReadParam.callbackFunction; // asynch callback function
    this.oCbData = oReadParam.callbackData;       // data to pass to async callback
    this.aId = this.fnGetParamsWithAxisNrAndElemNr(oReadParam);
    this.aCurRequestId = [];
    this.aResponse = [];          // array of responses
    this.oRequest = oReadParam;
    this.sRequest = this.fnBuildRequest(this.aId);
}
COM_GetVar.prototype = new COM_Obj();
COM_GetVar.prototype.constructor = COM_GetVar;

COM_GetVar.prototype.fnBuildRequest = function (aId)
{
    var nId, nVar, nIds, aReq = [];
    nIds = aId.length;
    // limit the number of items requested at one time
    if (nIds > MAX_ITEMS_PER_REQUEST) { nIds = MAX_ITEMS_PER_REQUEST; }
    // build the request string
    aReq[aReq.length] = [g_sHost, "/getvar.cgi?var1=", aId[0]].join("");
    for (nId = 1, nVar = 2; nId < nIds; nId++, nVar++)
    {
        aReq[aReq.length] = ["var", nVar, "=", aId[nId]].join("");
    }
    this.nAsyncTimeout_ms = MIN_XACT_ms + (nIds * 400);    // timeout for asynchronous timer
    return aReq.join('&');
};

COM_GetVar.prototype.fnParseResponse = function (sResponse)
{
    var aRetry = [], sItem, nItem, nStart, nEnd, nItems;

    nItems = this.aId.length;
    for (nEnd = nItem = 0; nItem < nItems; nItem++)
    {
        sItem = this.aId[nItem] + "=";
        nStart = sResponse.indexOf(sItem);
        if (nStart < 0) // item not found
        {
            continue;
        }
        nEnd = sResponse.indexOf('&', nStart);
        if (nEnd < 0)
        {
            this.aResponse[nItem] = new StringRef(sResponse.slice(nStart + sItem.length));
        }
        else
        {
            this.aResponse[nItem] = new StringRef(sResponse.slice(nStart + sItem.length, nEnd));
        }

        // 04.03.2011, CH, REQ-00015416: Formatierung der empfangenen Werte zwischen -1 und 1
        if ((this.aResponse[nItem].toString().substring(0, 1) == ".") && (parseFloat(this.aResponse[nItem]) >= 0))
        {
            this.aResponse[nItem].value = "0" + this.aResponse[nItem].toString();
        }
        if ((this.aResponse[nItem].toString().substring(0, 1) == "-") && (this.aResponse[nItem].toString().substring(1, 2) == ".") && (parseFloat(this.aResponse[nItem])))
        {
            this.aResponse[nItem].value = "-0." + this.aResponse[nItem].toString().substring(2, this.aResponse[nItem].toString().length);
        }

        // Check for retry errors
        if (this.fnValidateResponse(this.aResponse[nItem], this.aId[nItem]))
        {
            aRetry[aRetry.length] = this.aId[nItem];
        }
    }
    // Build a string of retries
    if (aRetry.length && this.fnCanRetry())
    {
        this.sRequest = this.fnBuildRequest(aRetry);
        return true;
    }
    // larger request blocks are broken into multiple reads
    if (this.aId.length > this.aResponse.length)
    {
        aRetry.length = 0;
        nItems = this.aId.length;
        for (nEnd = 0, nItem = this.aResponse.length; nItem < nItems; nItem++, nEnd++)
        {
            aRetry[nEnd] = this.aId[nItem];
        }
        this.sRequest = this.fnBuildRequest(aRetry);
        this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
        return true;
    }
    // Save the response
    this.sResponse = this.aResponse.join('|');
    this.oResponse = this.fnAddValuesToObject(this.oRequest, this.sResponse);

    return false;
};

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : COM_SetVar-Objekt
* INPUT   : ComLib-Objekt
* OUTPUT  : -
**************************************************************************************************/
function COM_SetVar(oWriteParam)
{
    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_SetVar';
    this.HTTP_Type = "POST";
    this.fnCallback = oWriteParam.callbackFunction; // asynch callback function
    this.oCbData = oWriteParam.callbackData;    // data to pass to async callback
    this.sId = this.fnGetParamsWithAxisNrAndElemNr(oWriteParam);
    this.sRequest = [g_sHost, "/setvar.cgi"].join("");
    this.oRequest = oWriteParam;
    this.sContent = ["var=", this.sId, "&value=", oWriteParam.parameters[0].data].join("");
    this.nAsyncTimeout_ms = MIN_XACT_ms * 2;    // timeout for asynchronous timer
}
COM_SetVar.prototype = new COM_Obj();
COM_SetVar.prototype.constructor = COM_SetVar;

COM_SetVar.prototype.fnParseResponse = function (sResponse)
{
    var sItem = this.sId + "=", bRc = true, sRef;

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, this.sId);
        this.sResponse = sRef.toString();
        this.oResponse = this.fnAddValuesToObject(this.oRequest, this.sResponse);
    }
    // Do not keep retrying if the WS is not responding
    if (bRc && !this.fnCanRetry())
    {
        if (this.sResponse === STATE_WARNING_BUSY)
        {
            this.sResponse = ERROR_BUSY_TIMEOUT;
        }
        else
        {
            this.sResponse = ERROR_WRITE_FAILED;
        }
        bRc = false;
    }
    return bRc;
};

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : COM_SetMldVar-Objekt
* INPUT   : ComLib-Objekt
* OUTPUT  : -
**************************************************************************************************/
function COM_SetMldVar(oSetMldVar)
{
    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_SetMldVar';
    this.HTTP_Type = "POST";
    this.fnCallback = oSetMldVar.callbackFunction; // asynch callback function
    this.oCbData = oSetMldVar.callbackData;    // data to pass to async callback
    this.sId = oSetMldVar.parameters[0].parameterId;
    this.sRequest = [g_sHost, "/setvar.cgi"].join("");
    this.oRequest = oSetMldVar;
    this.sContent = ["var=", this.sId, "&value=", oSetMldVar.parameters[0].data].join("");
    this.nAsyncTimeout_ms = MIN_XACT_ms * 2;    // timeout for asynchronous timer
}
COM_SetMldVar.prototype = new COM_Obj();
COM_SetMldVar.prototype.constructor = COM_SetMldVar;

COM_SetMldVar.prototype.fnParseResponse = function (sResponse)
{
    var sItem = this.sId + "=", bRc = true, sRef;

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, this.sId);
        this.sResponse = sRef.toString();
        this.oResponse = this.fnAddValuesToObject(this.oRequest, this.sResponse);
    }
    // Do not keep retrying if the WS is not responding
    if (bRc && !this.fnCanRetry())
    {
        if (this.sResponse === STATE_WARNING_BUSY)
        {

            this.sResponse = ERROR_BUSY_TIMEOUT;
        }
        else
        {
            this.sResponse = ERROR_WRITE_FAILED;
        }
        bRc = false;
    }
    return bRc;
};

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : COM_GetLst-Objekt
* INPUT   : ComLib-Objekt
* OUTPUT  : -
**************************************************************************************************/
function COM_GetLst(oReadListParam)
{
    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_GetLst';
    this.fnCallback = oReadListParam.callbackFunction; // asynch callback function
    this.oCbData = oReadListParam.callbackData;    // data to pass to async callback
    // initialize the object specific properties
    this.sId = this.fnGetParamWithAxisNr(oReadListParam);
    this.nIndex = 0; // current list index
    this.aPartialResponse = [];
    this.nCurListSize = this.nMaxListSize = 0; // current/max list parameter size
    this.fnParseResponse = this.fnParseTypeInfo; // change the asynch callback function
    this.sRequest = this.fnBuildTypeRequest(oReadListParam);
    this.oRequest = oReadListParam;
    this.nAsyncTimeout_ms = MIN_XACT_ms;    // timeout for asynchronous timer
    this.nCount = oReadListParam.parameters[0].count;
    this.nOffset = oReadListParam.parameters[0].offset;

    if (typeof this.nOffset != "undefined")
    {
        if (typeof this.nOffset == "string")
        {
            this.nOffset = this.fnGetIntFromString(this.nOffset);
        }
        this.nIndex = this.nOffset;
    }

    if (typeof this.nCount != "undefined")
    {
        if (typeof this.nCount == "string")
        {
            this.nCount = this.fnGetIntFromString(this.nCount);

            if (isNaN(this.nCount))
            {
                this.nCount = undefined;
            }
        }

        if (typeof this.nOffset == "undefined")
        {
            this.nOffset = 0;
        }
    }
}
COM_GetLst.prototype = new COM_Obj();
COM_GetLst.prototype.constructor = COM_GetLst;

COM_GetLst.prototype.fnBuildTypeRequest = function (oReadListParam)
{
    var aRequest = [];

    aRequest.push(g_sHost);

    if (this.fnIsValidParameterFormat(oReadListParam.parameters[0].parameterId))
    {
        aRequest.push("/readvartype.cgi?var=");
    }
    else
    {
        aRequest.push("/getvarinfo.cgi?var=");
    }

    aRequest.push(this.fnGetParamWithAxisNr(oReadListParam));

    return aRequest.join("");
};

COM_GetLst.prototype.fnParseTypeInfo = function (sResponse)
{
    var sItem = this.sId + "=", bRc = true, sRef, aData, oResponse = new Object();

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, this.sId);
        if (!bRc)
        {
            this.sResponse = sRef.toString();
            if (!this._fnIsError(this.sResponse))
            {
                aData = this.sResponse.split("|");
                if (aData.length >= 3)
                {
                    this.nMaxListSize = parseInt(aData[2], 10); // inserted in WS for 10V04 (8/10/2009)
                    this.nCurListSize = parseInt(aData[aData.length - 1], 10);

                    if ((typeof this.nOffset != "undefined") && typeof this.nCount == "undefined")
                    {
                        this.nCount = this.nCurListSize - this.nOffset;

                        if (this.nCount < 0)
                        {
                            this.nCount = 0;
                        }
                    }

                    if (typeof this.nOffset != "undefined")
                    {
                        if ((this.nCurListSize > 0) && (this.nOffset >= this.nCurListSize))
                        {
                            oResponse = this.oRequest;
                            oResponse.onError = "error: Offset not possible";
                            if (typeof this.oRequest.callbackFunction != "undefined")
                            {
                                this.oResponse = oResponse;
                            }

                            return false;
                        }
                    }

                    if (!this.nCurListSize) // list is empty
                    {
                        this.oResponse = this.fnAddValuesToListObject(this.oRequest, "");
                        this.sResponse = "";
                    }
                    else if (this.nCurListSize <= MAX_LIST_ITEMS) // single read
                    {
                        this.fnParseResponse = this.fnParseStandardResponse; // asynch callback function
                        this.sRequest = this.fnBuildLstRequest(this.oRequest);
                        this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
                        this.bIsRetryWithNewRequest = true;
                        bRc = true;
                    }
                    else // block read
                    {
                        if ((typeof this.nOffset != "undefined") && (typeof this.nCount != "undefined"))
                        {
                            if ((this.nOffset + this.nCount) > this.nMaxListSize)
                            {
                                this.nCount = this.nMaxListSize - this.nOffset;
                            }
                        }

                        this.fnParseResponse = this.fnParsePartialResponse; // change the asynch callback function
                        this.sRequest = this.fnBuildBlockRequest();
                        this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
                        this.bIsRetryWithNewRequest = true;
                        bRc = true;
                    }
                }
            }
            else
            {
                oResponse = this.oRequest;
                oResponse.parameters[0].value = this.sResponse;

                if (typeof this.oRequest.callbackFunction != "undefined")
                {
                    this.oResponse = oResponse;
                }

                return false;
            }
        }
    }
    return bRc;
};

COM_GetLst.prototype.fnBuildLstRequest = function (oReadListParam)
{
    var aRequest = [];

    aRequest.push(g_sHost);
    aRequest.push("/getlst.cgi?var=");
    aRequest.push(this.fnGetParamWithAxisNr(oReadListParam));

    if (typeof this.nOffset != "undefined")
    {
        aRequest.push("&offset=");
        aRequest.push(this.nOffset);
    }

    if (typeof this.nCount != "undefined")
    {
        aRequest.push("&count=");
        aRequest.push(this.nCount);
    }

    return aRequest.join("");
};

COM_GetLst.prototype.fnParseStandardResponse = function (sResponse)
{
    var sItem = this.sId + "=", bRc = true, sRef;
    var aResponse = sResponse.split(sItem);
    var aResp = aResponse[1].split("|");

    for (var i = 0; i < aResp.length; i++)
    {
        if (aResp[i].substring(0, 1) == ".")
        {
            aResp[i] = "0" + aResp[i];
        }
        if ((aResp[i].substring(0, 1) == "-") && (aResp[i].substring(1, 2) == "."))
        {
            aResp[i] = "-0." + aResp.substring(2, aResp[i].length);
        }
    }

    sResponse = sItem + aResp.join("|");

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, this.sId);
        this.sResponse = sRef.toString();
        this.oResponse = this.fnAddValuesToListObject(this.oRequest, this.sResponse.split("|"), this.nOffset, this.nCount);
    }
    return bRc;
};

COM_GetLst.prototype.fnParsePartialResponse = function (sResponse)
{
    var bRc = false, sItem = this.sId + "=", sRef;

    // Check that we received the correct response
    if (sResponse.indexOf(sItem) !== 0)
    {
        return this.fnCanRetry();
    }

    sRef = new StringRef(sResponse.slice(sItem.length));
    if (this.fnValidateResponse(sRef, this.sId))
    {
        this.sResponse = sRef.toString();
        this.oResponse = this.fnAddValuesToListObject(this.oRequest, this.sResponse.split("|"), this.nOffset, this.nCount);
        bRc = this.fnCanRetry();
    }
    else // not an error - see if we are done
    {
        this.aPartialResponse[this.aPartialResponse.length] = sRef.toString();
        // Check if we should make more requests
        this.nIndex += MAX_LIST_ITEMS;

        if (typeof this.nCount == "undefined")
        {
            if (this.nIndex < this.nCurListSize)
            {
                this.sRequest = this.fnBuildBlockRequest();
                this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
                bRc = true;
            }
            else
            {
                this.sResponse = this.aPartialResponse.join("|");
                this.oResponse = this.fnAddValuesToListObject(this.oRequest, this.sResponse.split("|"), this.nOffset, this.nCount);
            } // done   
        }
        else
        {
            if ((this.nIndex < this.nCurListSize) && (this.nIndex < (this.nOffset + this.nCount)))
            {
                this.sRequest = this.fnBuildBlockRequest();
                this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
                bRc = true;
            }
            else
            {
                this.sResponse = this.aPartialResponse.join("|");
                this.oResponse = this.fnAddValuesToListObject(this.oRequest, this.sResponse.split("|"), this.nOffset, this.nCount);
            }
        }
    }
    return bRc;
};

COM_GetLst.prototype.fnBuildBlockRequest = function ()
{
    var sReq, nCount = MAX_LIST_ITEMS;

    if (this.nIndex + MAX_LIST_ITEMS > this.nCurListSize)
    {
        nCount = this.nCurListSize - this.nIndex;
    }

    if (typeof this.nCount != "undefined")
    {
        if ((this.nIndex + nCount) > (this.nOffset + this.nCount))
        {
            // es wuerde zu viel gelesen werden --> Teilblock
            nCount = nCount - ((this.nIndex + nCount) - (this.nOffset + this.nCount));
        }
    }

    sReq = [g_sHost, "/getlst.cgi?var=", this.sId, "&offset=", this.nIndex, "&count=", nCount].join("");
    this.nAsyncTimeout_ms = MIN_XACT_ms + (nCount * 400);    // timeout for asynchronous timer

    return sReq;
};

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : COM_SetLst-Objekt
* INPUT   : ComLib-Objekt
* OUTPUT  : -
**************************************************************************************************/
function COM_SetLst(oWriteListParam)
{
    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_SetLst';
    this.HTTP_Type = "GET";
    this.fnCallback = oWriteListParam.callbackFunction; // asynch callback function
    this.oCbData = oWriteListParam.callbackData;    // data to pass to async callback
    // initialize the object specific properties
    this.sId = this.fnGetParamWithAxisNr(oWriteListParam);
    this.nIndex = 0;
    this.aData = oWriteListParam.parameters[0].data;

    if (this.fnIsValidParameterFormat(oWriteListParam.parameters[0].parameterId))
    {
        this.sRequest = [g_sHost, "/readvartype.cgi?var=", this.sId].join("");
    }
    else
    {
        this.sRequest = [g_sHost, "/getvarinfo.cgi?var=", this.sId].join("");
    }

    this.oRequest = oWriteListParam;
    this.nAsyncTimeout_ms = MIN_XACT_ms + (this.aData.length * 400);    // timeout for asynchronous timer
    this.nCount = oWriteListParam.parameters[0].count;
    this.nOffset = oWriteListParam.parameters[0].offset;
    this.fnParseResponse = this.fnParseTypeInfo;

    if (typeof this.nOffset != "undefined")
    {
        if (typeof this.nOffset == "string")
        {
            this.nOffset = this.fnGetIntFromString(this.nOffset);
        }

        this.nIndex = this.nOffset;
    }
    else
    {
        this.nOffset = 0;
    }

    if (typeof this.nCount != "undefined")
    {
        if (typeof this.nCount == "string")
        {
            this.nCount = this.fnGetIntFromString(this.nCount);

            if (isNaN(this.nCount))
            {
                this.nCount = undefined;
            }
        }
    }
}
COM_SetLst.prototype = new COM_Obj();
COM_SetLst.prototype.constructor = COM_SetLst;

COM_SetLst.prototype.fnParseTypeInfo = function (sResponse)
{
    var sItem = this.sId + "=", bRc = true, sRef, aData, oResponse = new Object(), bBlockWrite = false;
    this.HTTP_Type = "POST";

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, this.sId);

        this.sResponse = sRef.toString();
        if (!this._fnIsError(this.sResponse))
        {
            aData = this.sResponse.split("|");
            if (aData.length >= 3)
            {
                this.nMaxListSize = parseInt(aData[2], 10); // inserted in WS for 10V04 (8/10/2009)
                this.nCurListSize = parseInt(aData[aData.length - 1], 10);
                if (typeof this.nCount == "undefined")
                {
                    if ((this.aData.length) <= MAX_LIST_ITEMS)
                    {
                        // Single Write
                        bBlockWrite = false;
                    }
                    else
                    {
                        // Block Write
                        bBlockWrite = true;
                    }
                }
                else
                {
                    if (((this.nCount + this.nOffset) - this.nIndex) <= MAX_LIST_ITEMS)
                    {
                        // Single Write
                        bBlockWrite = false;
                    }
                    else
                    {
                        // Block Write
                        bBlockWrite = true;
                    }
                }

                if (bBlockWrite)
                {
                    this.fnParseResponse = this.fnParsePartialResponse; // change the asynch callback function
                    this.sRequest = this.fnBuildBlockRequest();
                    this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
                    this.bIsRetryWithNewRequest = true;
                    bRc = true;
                }
                else
                {
                    this.fnParseResponse = this.fnParseStandardResponse; // asynch callback function
                    this.sRequest = this.fnBuildLstRequest();
                    this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
                    this.bIsRetryWithNewRequest = true;
                    bRc = true;
                }
            }
        }
        else
        {
            oResponse = this.oRequest;
            oResponse.parameters[0].value = this.sResponse;

            if (typeof this.oRequest.callbackFunction != "undefined")
            {
                this.oResponse = oResponse;
            }

            return false;
        }
    }

    return bRc;
};

COM_SetLst.prototype.fnBuildBlockRequest = function ()
{
    var aReq = [], aContents = [], nCount = 0, aWriteData = [], nCountTotal = 0, nOffset = 0;

    if (typeof this.nCount != "undefined")
    {
        if ((this.nCount - this.nIndex) > MAX_LIST_ITEMS)
        {
            nCount = MAX_LIST_ITEMS;
        }
        else
        {
            nCount = this.nCount - (this.nIndex - this.nOffset);
        }

        nCountTotal = this.nCount;
    }
    else
    {
        if (((this.aData.length + this.nOffset) - this.nIndex) > MAX_LIST_ITEMS)
        {
            nCount = MAX_LIST_ITEMS;
        }
        else
        {
            nCount = (this.aData.length + this.nOffset) - this.nIndex;
        }

        nCountTotal = this.aData.length;
    }

    if (nCount > MAX_LIST_ITEMS)
    {
        nCount = MAX_LIST_ITEMS;
    }

    aReq.push(g_sHost);
    aReq.push("/setlst.cgi");

    aContents.push("var=");
    aContents.push(this.sId);
    aContents.push("&values=");

    for (var i = this.nIndex - this.nOffset, j = 0; j < nCount; i++, j++)
    {
        if (typeof this.aData[i] != "undefined")
        {
            aWriteData[j] = this.aData[i];
        }
    }

    aContents.push(aWriteData.join("|"));
    aContents.push("&offset=");

    if (nCountTotal > MAX_LIST_ITEMS)
    {
        if (nCountTotal > this.aData.length)
        {
            if (this.nIndex > (this.aData.length + this.nOffset))
            {
                nOffset = this.nOffset + this.aData.length;
            }
            else
            {
                nOffset = this.nIndex;
            }
        }
        else
        {
            nOffset = this.nIndex;
        }
    }
    else
    {
        nOffset = this.nIndex;
    }

    aContents.push(nOffset);
    aContents.push("&count=");
    aContents.push(nCount);

    this.sContent = aContents.join("");
    this.nAsyncTimeout_ms = MIN_XACT_ms + (nCount * 400);    // timeout for asynchronous timer

    return aReq.join("");
};

COM_SetLst.prototype.fnBuildLstRequest = function ()
{
    var aRequest = [], aContents = [];

    aRequest.push(g_sHost);
    aRequest.push("/setlst.cgi");

    aContents.push("var=");
    aContents.push(this.sId);
    aContents.push("&values=");

    if (typeof this.nCount != "undefined")
    {
        var aWriteData = [];

        for (var i = 0; i < this.nCount; i++)
        {
            if (typeof this.aData[i] != "undefined")
            {
                aWriteData.push(this.aData[i]);
            }
        }

        aContents.push(aWriteData.join("|"));
    }
    else
    {
        aContents.push(this.aData.join("|"));
    }

    aContents.push("&offset=");
    aContents.push(this.nOffset);

    if (typeof this.nCount != "undefined")
    {
        aContents.push("&count=");
        aContents.push(this.nCount);
    }

    this.sContent = aContents.join("");

    return aRequest.join("");
};

COM_SetLst.prototype.fnParsePartialResponse = function (sResponse)
{
    var bRc = false, sItem = this.sId + "=", sRef;

    // Check that we received the correct response
    if (sResponse.indexOf(sItem) !== 0)
    {
        return this.fnCanRetry();
    }

    sRef = new StringRef(sResponse.slice(sItem.length));

    if (this.fnValidateResponse(sRef, this.sId))
    {
        this.sResponse = sRef.toString();
        this.oResponse = this.oRequest;
        this.oResponse.parameters[0].value = this.sResponse;
        bRc = this.fnCanRetry();
    }
    {
        // Check if we should make more requests
        this.nIndex += MAX_LIST_ITEMS;

        if (typeof this.nCount != "undefined")
        {
            if ((this.nCount + this.nOffset) > this.nIndex)
            {
                // noch nicht fertig
                this.sRequest = this.fnBuildBlockRequest();
                this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
                bRc = true;
            }
            else
            {
                // fertig
                this.sResponse = sRef.toString();
                this.oResponse = this.oRequest;
                this.oResponse.parameters[0].value = this.sResponse;
            }
        }
        else
        {
            if ((this.aData.length + this.nOffset) > this.nIndex)
            {
                // noch nicht fertig
                this.sRequest = this.fnBuildBlockRequest();
                this.fnParseResponse = this.fnParsePartialResponse;
                this.oDate.setSeconds(this.oDate.getSeconds() + MAX_RETRY_sec);
                bRc = true;
            }
            else
            {
                // fertig
                this.sResponse = sRef.toString();
                this.oResponse = this.oRequest;
                this.oResponse.parameters[0].value = this.sResponse;
            }
        }
    }
    return bRc;
};

COM_SetLst.prototype.fnParseStandardResponse = function (sResponse)
{
    var sItem = this.sId + "=", bRc = true, sRef;
    var aResponse = sResponse.split(sItem);
    var aResp = aResponse[1].split("|");

    sResponse = sItem + aResp.join("|");

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, this.sId);
        this.sResponse = sRef.toString();
        this.oResponse = this.oRequest;
        this.oResponse.parameters[0].value = this.sResponse;
    }

    return bRc;
};

COM_SetLst.prototype.fnParseResponse = function (sResponse)
{
    var sItem = this.sId + "=", bRc = true, sRef;

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, this.sId);
        this.sResponse = sRef.toString();
    }
    // Do not keep retrying if the WS is not responding
    if (bRc && !this.fnCanRetry())
    {
        if (this.sResponse === STATE_WARNING_BUSY)
        {
            this.sResponse = ERROR_BUSY_TIMEOUT;
        }
        else
        {
            this.sResponse = ERROR_WRITE_FAILED;
        }
        bRc = false;
    }
    return bRc;
};

/*************************************************************************************************
* CONSTRUCTOR
* COMMENT : COM_ReadVarType-Objekt
* INPUT   : ComLib-Objekt
* OUTPUT  : -
**************************************************************************************************/
function COM_ReadVarType(oGetParameterInformation)
{
    // initialize the base properties
    COM_Obj.call(this);
    this.sTypeOf = 'COM_ReadVarType';
    this.fnCallback = oGetParameterInformation.callbackFunction; // asynch callback function
    this.oCbData = oGetParameterInformation.callbackData;    // data to pass to async callback
    // initialize the object specific properties
    this.sId = this.fnGetParamWithAxisNr(oGetParameterInformation);

    if (this.fnIsValidParameterFormat(oGetParameterInformation.parameters[0].parameterId))
    {
        this.sRequest = [g_sHost, "/readvartype.cgi?var=", this.sId].join("");
    }
    else
    {
        this.sRequest = [g_sHost, "/getvarinfo.cgi?var=", this.sId].join("");
    }

    this.oRequest = oGetParameterInformation;
    this.nAsyncTimeout_ms = MIN_XACT_ms;    // timeout for asynchronous timer

    /*************************************************************************************************
    * FUNCTION: fnAddVarTypeToObject
    * COMMENT : Wertet die ReadVartype und Getvarinfo aus und ergaenzt die Werte beim Objekt
    * INPUT   : ComLib-Objekt, ausgelesene Werte
    * OUTPUT  : Ergaenztes Objekt
    **************************************************************************************************/
    this.fnAddVarTypeToObject = function (oObject, aVarTypes)
    {
        var sDataType = "";

        if ((aVarTypes.length == 1) && this._fnIsError(aVarTypes[0]))
        {
            oObject.parameters[0].value = aVarTypes[0];
        }
        else
        {
            switch (parseInt(aVarTypes[0], 10).toString(16))
            {
                // Datentyp anhand des Hex-Werts ermitteln
                case "1":
                    sDataType = "BOOL";
                    break;
                case "2":
                    sDataType = "INT8";
                    break;
                case "3":
                    sDataType = "INT16";
                    break;
                case "4":
                    sDataType = "INT32";
                    break;
                case "5":
                    sDataType = "UINT8";
                    break;
                case "6":
                    sDataType = "UINT16";
                    break;
                case "7":
                    sDataType = "UINT32";
                    break;
                case "8":
                    sDataType = "FLOAT32";
                    break;
                case "9":
                    sDataType = "UTF8STR";
                    break;
                case "81":
                    sDataType = "INT64";
                    break;
                case "82":
                    sDataType = "UINT64";
                    break;
                case "83":
                    sDataType = "FLOAT64";
                    break;
                case "84":
                    sDataType = "BIT";
                    break;
                case "85":
                    sDataType = "FIXPNT32";
                    break;
                case "86":
                    sDataType = "FIXPNT64";
                    break;
                case "FF":
                    sDataType = "not supported";
                    break;
                default:
                    break;
            }

            oObject.parameters[0].value = new Object();
            oObject.parameters[0].value.dataType = sDataType;
            oObject.parameters[0].value.elementLength = parseInt(aVarTypes[1], 10);
            oObject.parameters[0].value.maxListLength = parseInt(aVarTypes[2], 10);
            oObject.parameters[0].value.actListLength = parseInt(aVarTypes[aVarTypes.length - 1], 10);
        }

        return oObject;
    };
}
COM_ReadVarType.prototype = new COM_Obj();
COM_ReadVarType.prototype.constructor = COM_ReadVarType;

COM_ReadVarType.prototype.fnParseResponse = function (sResponse)
{
    var sItem = this.sId + "=", bRc = true, sRef;

    if (sResponse.indexOf(sItem) === 0)
    {
        sRef = new StringRef(sResponse.slice(sItem.length));
        bRc = this.fnValidateResponse(sRef, this.sId);
        this.sResponse = sRef.toString();
        this.oResponse = this.fnAddVarTypeToObject(this.oRequest, this.sResponse.split("|"));
    }
    return bRc;
};
